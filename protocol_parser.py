"""
VRF Protocol Parser
====================
Parses raw protocol strings from the VRF system into structured JSON data.

Protocol Format:
    * = Start marker
    # = End marker

Supported Protocols:
    TOC  = Temperature Operating Command
    PRS  = Pressure Reading Status
    CMP  = Compressor Status
    FAN  = Fan Status
    PWR  = Power Reading
    ALM  = Alarm / Fault Status
    SHT  = Superheat Temperature
    SCL  = Subcooling Level
    COP  = Coefficient of Performance
    EVP  = Evaporator Temperature
    CND  = Condenser Temperature

Raw String Structure (12 chars between * and #):
    Chars 1-3  : Protocol Name
    Chars 4-6  : Value (numeric, 3 digits, zero-padded)
    Chars 7-8  : Status Code
                    AA = Normal / OK
                    HH = High (above normal range)
                    LL = Low (below normal range)
                    ER = Error / Fault
                    OF = Off
                    WW = Warning
    Chars 9-10 : Hour (00-23)
    Chars 11-12: Minute (00-59)

Example:
    *TOC024AA1401#  → Temperature = 24°C, Status = Normal, Time = 14:01
    *PRS085HH0930#  → Suction Pressure = 8.5 bar, Status = High, Time = 09:30
    *ALM00100000#   → Alarm Code 001, Time = 00:00
"""

from datetime import datetime
from typing import Any
import json
import re

from protocol_catalog import (
    candidate_sheets_for_frame,
    get_catalog_summary,
    get_sheet_definition,
)

# ─────────────────────────────────────────────
#  MULTI-PACKET PARSER
# ─────────────────────────────────────────────

FRAME_RE = re.compile(r"\*[^#]*#")
HEX_RE = re.compile(r"^[0-9A-Fa-f]+$")


def calculate_crc16_ascii(frame_without_crc: str) -> str:
    """CRC-16/Modbus over ASCII bytes, returned as 4 uppercase hex chars."""
    crc = 0xFFFF
    for byte in frame_without_crc.encode("ascii", errors="ignore"):
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return f"{crc & 0xFFFF:04X}"


def _normalize_field_key(parameter: str) -> str:
    text = parameter.strip().lower().replace("/", " ").replace("-", " ")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_") or "field"


def _extract_enum_label(raw_value: str, description: str) -> str | None:
    if not raw_value or not description:
        return None

    candidates = []
    if len(raw_value) == 1:
        candidates.append(f"{ord(raw_value):02X}")
    if HEX_RE.match(raw_value):
        candidates.append(raw_value.upper())

    for match in re.finditer(r"0x([0-9A-Fa-f]{1,4})\s*=\s*([^0\r\n]+)", description):
        code = match.group(1).upper().zfill(2)
        label = match.group(2).strip(" :-\t")
        if code in candidates and label:
            return re.sub(r"\s+", " ", label)
    return None


def _decode_raw_field(raw_value: str, parameter: str, description: str) -> dict[str, Any]:
    decoded: dict[str, Any] = {
        "raw": raw_value,
        "value": raw_value,
        "value_type": "text",
    }

    label = _extract_enum_label(raw_value, description)
    if label:
        decoded["label"] = label

    param_text = parameter.lower()
    desc_text = description.lower()
    param_tokens = set(re.split(r'\W+', param_text))
    is_temperature = "temp" in param_text or "temperature" in desc_text or any(x in param_tokens for x in ["tamb", "tgas", "tgas1", "tgas2", "tliq", "tliq1", "tliq2", "indoor"])
    has_decimal_hint = "/10" in desc_text or "decimal" in desc_text or ".0" in desc_text

    # Signed ASCII digits (e.g. '+100', '-050') -> prefer decimal parsing
    if len(raw_value) >= 2 and raw_value[0] in "+-" and raw_value[1:].isdigit():
        sign = -1 if raw_value[0] == "-" else 1
        number = sign * int(raw_value[1:])
        if is_temperature or has_decimal_hint:
            number = number / 10
        decoded.update({"value": number, "value_type": "number"})
        return decoded

    numeric_hint = any(
        token in param_text or token in desc_text
        for token in [
            "range",
            "unsigned",
            "byte",
            "characters",
            "hex",
            "system id",
            "command",
            "date",
            "month",
            "year",
            "hour",
            "minute",
            "second",
            "pressure",
            "rpm",
            "speed",
            "current",
            "voltage",
            "frequency",
            "capacity",
            "watt",
            "toc",
            "ecc",
        ]
    )

    # Prefer pure decimal digit parsing for ASCII numeric fields
    if raw_value.isdigit():
        number = int(raw_value)
        if is_temperature or has_decimal_hint:
            number = number / 10
        decoded.update({"value": number, "value_type": "number"})
    # If the description or content implies hex (contains letters a-f or 0x hints), parse as hex
    elif raw_value and (re.search(r"[A-Fa-f]", raw_value) or "0x" in description.lower()) and HEX_RE.match(raw_value) and len(raw_value) <= 6 and numeric_hint:
        number = int(raw_value, 16)
        if is_temperature or has_decimal_hint:
            number = number / 10
        decoded.update({"value": number, "value_type": "number"})
    # As a fallback, if it's hex-like but no letters (e.g. '1000') and description explicitly mentions hex, parse hex
    elif raw_value and HEX_RE.match(raw_value) and len(raw_value) <= 6 and numeric_hint and "hex" in desc_text:
        number = int(raw_value, 16)
        if is_temperature or has_decimal_hint:
            number = number / 10
        decoded.update({"value": number, "value_type": "number"})

    return decoded


def _decode_against_sheet(
    raw: str, sheet_name: str, include_missing: bool = False
) -> dict[str, Any]:
    sheet = get_sheet_definition(sheet_name) or {}
    decoded_fields = []
    present_count = 0
    numeric_count = 0

    for field in sheet.get("fields", []):
        start = field.get("byte_no")
        length = field.get("length")
        parameter = str(field.get("parameter") or "").strip()
        description = str(field.get("description") or "").strip()

        if start is None or length is None or length <= 0:
            continue
        if not parameter and not description:
            continue

        end = start + length
        raw_value = raw[start:end] if start < len(raw) else ""
        is_present = len(raw_value) == length

        if not is_present and not include_missing:
            continue

        decoded = _decode_raw_field(raw_value, parameter, description) if is_present else {}
        if is_present:
            present_count += 1
        if decoded.get("value_type") == "number":
            numeric_count += 1

        decoded_fields.append(
            {
                "sheet": sheet_name,
                "row": field.get("row"),
                "group": field.get("group"),
                "byte_no": start,
                "length": length,
                "parameter": parameter,
                "field_key": _normalize_field_key(parameter),
                "description": description,
                "raw_value": raw_value if is_present else None,
                "decoded_value": decoded.get("value"),
                "decoded_label": decoded.get("label"),
                "value_type": decoded.get("value_type"),
                "present": is_present,
            }
        )

    mapped_bytes = set()
    for field in sheet.get("fields", []):
        start = field.get("byte_no")
        length = field.get("length")
        if start is not None and length is not None and length > 0:
            for i in range(start, min(start + length, len(raw))):
                mapped_bytes.add(i)

    unmapped_blocks = []
    current_block = []
    current_start = -1
    for i in range(len(raw)):
        if i not in mapped_bytes:
            if current_start == -1:
                current_start = i
            current_block.append(raw[i])
        else:
            if current_start != -1:
                unmapped_blocks.append((current_start, ''.join(current_block)))
                current_start = -1
                current_block = []
    if current_start != -1:
        unmapped_blocks.append((current_start, ''.join(current_block)))

    block_count = 1
    for start, val in unmapped_blocks:
        decoded_fields.append({
            "sheet": sheet_name,
            "row": "Dynamic",
            "group": "Unmapped Data",
            "byte_no": start,
            "length": len(val),
            "parameter": f"Unmapped Block {block_count}",
            "field_key": f"unmapped_block_{block_count}",
            "description": "Unmapped byte sequence",
            "raw_value": val,
            "decoded_value": val,
            "decoded_label": None,
            "value_type": "text",
            "present": True,
        })
        block_count += 1
        present_count += 1

    return {
        "sheet_name": sheet_name,
        "dimension": sheet.get("dimension"),
        "frame_patterns": sheet.get("frame_patterns", []),
        "field_count": len(sheet.get("fields", [])),
        "present_field_count": present_count,
        "numeric_field_count": numeric_count,
        "fields": decoded_fields,
    }


def _company_reading_from_fields(fields: list[dict[str, Any]]) -> dict[str, Any]:
    reading: dict[str, Any] = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ambient_temp": None,
        "indoor_temp": None,
        "setpoint_temp": 24.0,
        "suction_pressure": None,
        "discharge_pressure": None,
        "compressor_speed": None,
        "fan_speed": None,
        "power_consumption": None,
        "superheat": None,
        "subcooling": None,
        "cop": None,
        "evap_temp": None,
        "cond_temp": None,
        "suction_temp": None,
        "oil_temp1": None,
        "oil_temp2": None,
        "tgas1": None,
        "tliq1": None,
        "tamb": None,
        "fault_mode": "none",
        "compressor_on": True,
        "source": "company_protocol",
    }

    def set_if_empty(key: str, value: Any) -> None:
        if value is not None and reading.get(key) is None:
            reading[key] = value

    for field in fields:
        value = field.get("decoded_value")
        if field.get("value_type") != "number":
            continue

        # Normalize parameter/description for robust matching
        name = f"{field.get('parameter', '')} {field.get('description', '')}".lower()
        name_tokens = set(re.split(r'\W+', name))
        key = field.get("field_key") or ""

        # Temperature aliases
        if "tamb" in name_tokens or "ambient" in name_tokens or "ambient temp" in name:
            set_if_empty("ambient_temp", value)
        elif "indoor" in name_tokens or "indoor temp" in name:
            set_if_empty("indoor_temp", value)
        elif any(tok in name for tok in ("tgas", "tgas1", "tgas2")) or key.startswith("tgas"):
            set_if_empty("tgas1", value)
        elif any(tok in name for tok in ("tliq", "tliq1", "tliq2")) or key.startswith("tliq"):
            set_if_empty("tliq1", value)
        elif "oil temp" in name or "oil temp1" in name:
            set_if_empty("oil_temp1", value)
        elif "oil temp2" in name:
            set_if_empty("oil_temp2", value)
        elif "suction temp" in name:
            set_if_empty("suction_temp", value)

        # Pressure
        elif "suction" in name and "pressure" in name:
            set_if_empty("suction_pressure", value)
        elif "low pressure" in name:
            set_if_empty("suction_pressure", value)
        elif "discharge" in name and "pressure" in name:
            set_if_empty("discharge_pressure", value)
        elif "high pressure" in name:
            set_if_empty("discharge_pressure", value)

        # Rotational / speed
        elif ("compressor" in name and ("rpm" in name or "speed" in name or "frequency" in name)) or key.startswith("rps") or "rps" in name:
            rpm = value * 60 if "rps" in name else value
            set_if_empty("compressor_speed", rpm)
        elif "fan" in name and ("rpm" in name or "speed" in name):
            set_if_empty("fan_speed", value)

        # Power / energy
        elif "watt" in name or "power" in name or key == "pwr":
            # Convert wattage to kW
            kw = value / 1000.0 if "watt" in name else value
            set_if_empty("power_consumption", kw)

        # General numeric -> possible fault
        elif "error code" in name or "fault" in name or "err" in name:
            if value not in (0, "0", None):
                reading["fault_mode"] = str(value)

    # If power is missing but we have compressor speed, estimate it (approx 0.005 kW per RPM)
    if reading["power_consumption"] is None and reading["compressor_speed"]:
        reading["power_consumption"] = round(reading["compressor_speed"] * 0.005, 2)

    # If COP is missing but we have power, calculate an estimated COP
    if reading["cop"] is None and reading["power_consumption"]:
        # Standard VRF COP ranges from 2.5 to 4.5 depending on load
        reading["cop"] = round(3.5 + (reading["power_consumption"] * 0.1), 2)

    return reading


def parse_company_protocol_frame(
    raw: str, frame_name: str | None = None, include_missing: bool = False
) -> dict:
    """
    Parse a company IVRF/DVRF/MVRF ASCII serial frame using the workbook catalog.

    Example frames from the workbook:
        *PC0C0101U0145A1#
        *PC0C0101E0180A0#
        *DR000E02XXX0A0675#
    """
    text = raw.strip()
    result: dict[str, Any] = {
        "raw": raw,
        "parser": "company_protocol",
        "parsed_ok": False,
        "error": None,
    }

    try:
        if not text.startswith("*") or not text.endswith("#"):
            raise ValueError("Missing start '*' or end '#' marker")
        if len(text) < 7:
            raise ValueError("Frame is too short")

        supplied_crc = text[-5:-1]
        crc_in_frame = bool(HEX_RE.match(supplied_crc) and len(supplied_crc) == 4)
        if crc_in_frame:
            crc_calculated = calculate_crc16_ascii(text[:-5])
            crc_valid = supplied_crc.upper() == crc_calculated
        else:
    # Binary CRC — still attempt field decoding
            crc_calculated = None
            crc_valid = None

        candidates = candidate_sheets_for_frame(text, frame_name)
        decoded_candidates = []
        for order, candidate in enumerate(candidates):
            decoded = _decode_against_sheet(text, candidate, include_missing=include_missing)
            decoded["_candidate_order"] = order
            decoded_candidates.append(decoded)
        decoded_candidates.sort(
            key=lambda item: (
                item["present_field_count"],
                item["numeric_field_count"],
                len(item.get("frame_patterns", [])),
                -item.get("_candidate_order", 0),
            ),
            reverse=True,
        )

        best = decoded_candidates[0] if decoded_candidates else {
            "sheet_name": frame_name or "unknown",
            "fields": [],
            "present_field_count": 0,
            "numeric_field_count": 0,
            "frame_patterns": [],
        }
        reading = _company_reading_from_fields(best.get("fields", []))
        frame_ok = crc_valid is not False  # None = binary CRC, still attempt decode

        result.update(
            {
                "raw": text,
                "frame_name": best.get("sheet_name"),
                "candidate_frames": [
                    {
                        "sheet_name": item["sheet_name"],
                        "present_field_count": item["present_field_count"],
                        "numeric_field_count": item["numeric_field_count"],
                    }
                    for item in decoded_candidates[:8]
                ],
                "start_marker": text[0],
                "end_marker": text[-1],
                "payload": text[1:-5] if crc_calculated else text[1:-1],
                "crc": supplied_crc.upper() if crc_calculated else None,
                "crc_calculated": crc_calculated,
                "crc_valid": crc_valid,
                "fields": best.get("fields", []),
                "field_count": best.get("field_count", 0),
                "present_field_count": best.get("present_field_count", 0),
                "numeric_field_count": best.get("numeric_field_count", 0),
                "reading": reading,
                "parsed_ok": frame_ok,
                "error": None if frame_ok else f"CRC mismatch: expected {crc_calculated}, got {supplied_crc.upper()}",
            }
        )
    except Exception as exc:
        result["error"] = str(exc)
        result["parsed_ok"] = False

    return result


def parse_protocol_string(raw: str) -> dict:
    """Parse the company protocol."""
    return parse_company_protocol_frame(raw)


def extract_raw_frames(raw_batch: str) -> list[str]:
    return [match.group(0).strip() for match in FRAME_RE.finditer(str(raw_batch))]


def parse_incoming_payload(payload: Any, frame_name: str | None = None) -> dict:
    """
    Parse JSON/string payloads from the communication device.

    Accepted shapes:
        {"raw": "*...#"}
        {"frame": "*...#"}
        {"frames": ["*...#", "*...#"]}
        {"raw_batch": "*...#\\n*...#"}
        "*...#"
    """
    raw_frames: list[str] = []

    def collect(value: Any) -> None:
        if value is None:
            return
        if isinstance(value, str):
            raw_frames.extend(extract_raw_frames(value))
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for key in ["raw", "raw_frame", "frame", "packet", "raw_batch", "data", "payload"]:
                if key in value:
                    collect(value[key])
            if "frames" in value:
                collect(value["frames"])

    collect(payload)
    parsed = [
        parse_company_protocol_frame(frame, frame_name=frame_name)
        if frame_name else parse_protocol_string(frame)
        for frame in raw_frames
    ]
    catalog_summary = get_catalog_summary()

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(raw_frames),
        "successful": sum(1 for item in parsed if item.get("parsed_ok")),
        "failed": sum(1 for item in parsed if not item.get("parsed_ok")),
        "frames": parsed,
        "catalog": {
            "source_file": catalog_summary.get("source_file"),
            "sheet_count": catalog_summary.get("sheet_count"),
            "field_count": catalog_summary.get("field_count"),
        },
    }


def parse_packet_batch(raw_batch: str) -> dict:
    """
    Parse a full batch of protocol strings (as received from VRF in one JSON payload).
    Multiple strings can be separated by newlines or commas.

    Input:
        '*TOC024AA1401#\n*PRS085AA1401#\n*CMP350AA1401#'

    Output:
        {
            'timestamp':  '2026-05-26 14:01:00',
            'parsed':     [...list of individual parse results...],
            'reading':    {unified sensor dict for ML + DB},
            'health':     'healthy' / 'warning' / 'unhealthy',
            'faults':     [...list of active faults...]
        }
    """
    raw_strings = extract_raw_frames(raw_batch)

    parsed_list = [parse_protocol_string(r) for r in raw_strings]
    successful  = [p for p in parsed_list if p["parsed_ok"]]

    # Build unified reading dict
    reading = {
        "timestamp":          datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ambient_temp":       None,
        "indoor_temp":        None,
        "setpoint_temp":      24.0,
        "suction_pressure":   None,
        "discharge_pressure": None,
        "compressor_speed":   None,
        "fan_speed":          None,
        "power_consumption":  None,
        "superheat":          None,
        "subcooling":         None,
        "cop":                None,
        "evap_temp":          None,
        "cond_temp":          None,
        "fault_mode":         "none",
        "compressor_on":      True,
        "source":             "protocol",
    }

    faults  = []
    healths = []

    for p in successful:
        for key, value in p.get("reading", {}).items():
            if key in reading and value is not None:
                reading[key] = value
        if p.get("crc_valid") is False:
            healths.append("warning")
        else:
            healths.append("healthy")

    # Overall health
    if "unhealthy" in healths:
        overall_health = "unhealthy"
    elif "warning" in healths:
        overall_health = "warning"
    else:
        overall_health = "healthy"

    return {
        "timestamp":  reading["timestamp"],
        "parsed":     parsed_list,
        "reading":    reading,
        "health":     overall_health,
        "faults":     faults,
        "total":      len(raw_strings),
        "successful": len(successful),
        "failed":     len(raw_strings) - len(successful),
    }


