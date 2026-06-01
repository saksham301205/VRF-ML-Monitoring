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
#  PROTOCOL DEFINITIONS
# ─────────────────────────────────────────────

PROTOCOL_MAP = {
    "TOC": {
        "name":        "Temperature Operating Command",
        "unit":        "°C",
        "field":       "indoor_temp",
        "scale":       1.0,
        "healthy_min": 16,
        "healthy_max": 30,
    },
    "AMB": {
        "name":        "Ambient Temperature",
        "unit":        "°C",
        "field":       "ambient_temp",
        "scale":       1.0,
        "healthy_min": 10,
        "healthy_max": 50,
    },
    "PRS": {
        "name":        "Pressure Reading Status",
        "unit":        "bar",
        "field":       "suction_pressure",
        "scale":       0.1,   # raw 085 → 8.5 bar
        "healthy_min": 4,
        "healthy_max": 12,
    },
    "DPS": {
        "name":        "Discharge Pressure Status",
        "unit":        "bar",
        "field":       "discharge_pressure",
        "scale":       0.1,   # raw 280 → 28.0 bar
        "healthy_min": 15,
        "healthy_max": 35,
    },
    "CMP": {
        "name":        "Compressor Status",
        "unit":        "RPM",
        "field":       "compressor_speed",
        "scale":       10.0,  # raw 350 → 3500 RPM
        "healthy_min": 1000,
        "healthy_max": 5500,
    },
    "FAN": {
        "name":        "Fan Speed Status",
        "unit":        "RPM",
        "field":       "fan_speed",
        "scale":       10.0,  # raw 128 → 1280 RPM
        "healthy_min": 500,
        "healthy_max": 1800,
    },
    "PWR": {
        "name":        "Power Consumption",
        "unit":        "kW",
        "field":       "power_consumption",
        "scale":       0.01,  # raw 595 → 5.95 kW
        "healthy_min": 1,
        "healthy_max": 10,
    },
    "SHT": {
        "name":        "Superheat Temperature",
        "unit":        "°C",
        "field":       "superheat",
        "scale":       0.1,
        "healthy_min": 3,
        "healthy_max": 15,
    },
    "SCL": {
        "name":        "Subcooling Level",
        "unit":        "°C",
        "field":       "subcooling",
        "scale":       0.1,
        "healthy_min": 2,
        "healthy_max": 12,
    },
    "COP": {
        "name":        "Coefficient of Performance",
        "unit":        "",
        "field":       "cop",
        "scale":       0.01,  # raw 320 → 3.20
        "healthy_min": 1.5,
        "healthy_max": 5.0,
    },
    "EVP": {
        "name":        "Evaporator Temperature",
        "unit":        "°C",
        "field":       "evap_temp",
        "scale":       0.1,   # raw 120 → 12.0°C
        "healthy_min": 5,
        "healthy_max": 20,
    },
    "CND": {
        "name":        "Condenser Temperature",
        "unit":        "°C",
        "field":       "cond_temp",
        "scale":       0.1,   # raw 450 → 45.0°C
        "healthy_min": 30,
        "healthy_max": 60,
    },
    "ALM": {
        "name":        "Alarm / Fault Status",
        "unit":        "code",
        "field":       "fault_mode",
        "scale":       1.0,
        "healthy_min": 0,
        "healthy_max": 0,
    },
}

STATUS_MAP = {
    "AA": {"label": "Normal",  "health": "healthy"},
    "HH": {"label": "High",    "health": "warning"},
    "LL": {"label": "Low",     "health": "warning"},
    "ER": {"label": "Error",   "health": "unhealthy"},
    "OF": {"label": "Off",     "health": "warning"},
    "WW": {"label": "Warning", "health": "warning"},
}

ALARM_MAP = {
    "000": "none",
    "001": "refrigerant_leak",
    "002": "compressor_overload",
    "003": "dirty_filter",
    "004": "sensor_drift",
    "005": "high_pressure_trip",
    "006": "low_pressure_trip",
    "007": "motor_fault",
    "008": "communication_error",
}


# ─────────────────────────────────────────────
#  CORE PARSER
# ─────────────────────────────────────────────

def parse_legacy_protocol_string(raw: str) -> dict:
    """
    Parse a single raw VRF protocol string into a structured dict.

    Input:  '*TOC024AA1401#'
    Output: {
        'raw':          '*TOC024AA1401#',
        'protocol':     'TOC',
        'name':         'Temperature Operating Command',
        'raw_value':    24,
        'value':        24.0,
        'unit':         '°C',
        'field':        'indoor_temp',
        'status_code':  'AA',
        'status_label': 'Normal',
        'health':       'healthy',
        'hour':         14,
        'minute':       1,
        'time_str':     '14:01',
        'timestamp':    '2026-05-26 14:01:00',
        'parsed_ok':    True
    }
    """
    result = {
        "raw":       raw,
        "parsed_ok": False,
        "error":     None
    }

    try:
        # Validate structure
        raw = raw.strip()
        if not raw.startswith("*") or not raw.endswith("#"):
            raise ValueError("Missing start '*' or end '#' marker")

        inner = raw[1:-1]  # strip * and #

        if len(inner) != 12:
            raise ValueError(f"Expected 12 chars between markers, got {len(inner)}: '{inner}'")

        # Extract fields
        protocol   = inner[0:3].upper()
        raw_value  = inner[3:6]
        status_code= inner[6:8].upper()
        hour_str   = inner[8:10]
        minute_str = inner[10:12]

        # Validate protocol
        if protocol not in PROTOCOL_MAP:
            raise ValueError(f"Unknown protocol: '{protocol}'")

        proto_def = PROTOCOL_MAP[protocol]

        # Parse numeric value
        try:
            int_value = int(raw_value)
        except ValueError:
            raise ValueError(f"Non-numeric value field: '{raw_value}'")

        scaled_value = round(int_value * proto_def["scale"], 3)

        # Parse time
        try:
            hour   = int(hour_str)
            minute = int(minute_str)
            if not (0 <= hour <= 23) or not (0 <= minute <= 59):
                raise ValueError()
        except ValueError:
            raise ValueError(f"Invalid time: '{hour_str}:{minute_str}'")

        now = datetime.now()
        ts  = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

        # Status
        status_info = STATUS_MAP.get(status_code, {"label": "Unknown", "health": "warning"})

        # Special handling for ALM protocol
        fault_mode = "none"
        if protocol == "ALM":
            fault_mode   = ALARM_MAP.get(raw_value, "unknown_fault")
            scaled_value = int_value
            if fault_mode != "none":
                status_info = {"label": "Fault Active", "health": "unhealthy"}

        # Override health if value is out of range
        health = status_info["health"]
        if protocol != "ALM":
            mn = proto_def["healthy_min"]
            mx = proto_def["healthy_max"]
            if scaled_value < mn or scaled_value > mx:
                health = "unhealthy" if abs(scaled_value - mn) > 0.2 * mn else "warning"

        result.update({
            "protocol":     protocol,
            "name":         proto_def["name"],
            "raw_value":    int_value,
            "value":        scaled_value,
            "unit":         proto_def["unit"],
            "field":        proto_def["field"],
            "status_code":  status_code,
            "status_label": status_info["label"],
            "health":       health,
            "fault_mode":   fault_mode,
            "hour":         hour,
            "minute":       minute,
            "time_str":     f"{hour:02d}:{minute:02d}",
            "timestamp":    ts.strftime("%Y-%m-%d %H:%M:%S"),
            "parsed_ok":    True,
            "error":        None
        })

    except Exception as e:
        result["error"] = str(e)
        result["parsed_ok"] = False

    return result


# ─────────────────────────────────────────────
#  MULTI-PACKET PARSER
# ─────────────────────────────────────────────

FRAME_RE = re.compile(r"\*[^#]*#")
HEX_RE = re.compile(r"^[0-9A-Fa-f]+$")


def _looks_like_legacy_protocol(raw: str) -> bool:
    text = raw.strip()
    if not text.startswith("*") or not text.endswith("#"):
        return False
    inner = text[1:-1]
    return len(inner) == 12 and inner[0:3].upper() in PROTOCOL_MAP


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
    is_temperature = "temp" in param_text or "temperature" in desc_text
    has_decimal_hint = "/10" in desc_text or "decimal" in desc_text or ".0" in desc_text

    if len(raw_value) >= 2 and raw_value[0] in "+-" and HEX_RE.match(raw_value[1:]):
        sign = -1 if raw_value[0] == "-" else 1
        number = sign * int(raw_value[1:], 16)
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

    if raw_value and HEX_RE.match(raw_value) and len(raw_value) <= 6 and numeric_hint:
        number = int(raw_value, 16)
        if is_temperature or has_decimal_hint:
            number = number / 10
        decoded.update({"value": number, "value_type": "number"})
    elif raw_value.isdigit():
        decoded.update({"value": int(raw_value), "value_type": "number"})

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

        name = f"{field.get('parameter', '')} {field.get('description', '')}".lower()
        if "ambient" in name and ("temp" in name or "temperature" in name):
            set_if_empty("ambient_temp", value)
        elif "indoor" in name and ("temp" in name or "temperature" in name):
            set_if_empty("indoor_temp", value)
        elif "suction" in name and "pressure" in name:
            set_if_empty("suction_pressure", value)
        elif "low pressure" in name:
            set_if_empty("suction_pressure", value)
        elif "discharge" in name and "pressure" in name:
            set_if_empty("discharge_pressure", value)
        elif "high pressure" in name:
            set_if_empty("discharge_pressure", value)
        elif "compressor" in name and ("rpm" in name or "speed" in name or "frequency" in name):
            set_if_empty("compressor_speed", value)
        elif "fan" in name and ("rpm" in name or "speed" in name):
            set_if_empty("fan_speed", value)
        elif "watt" in name or "power" in name:
            set_if_empty("power_consumption", value)
        elif "error code" in name or "fault" in name:
            if value not in (0, "0", None):
                reading["fault_mode"] = str(value)

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
        if not (HEX_RE.match(supplied_crc) and len(supplied_crc) == 4):
            raise ValueError("Missing or invalid 4-character CRC")
        crc_calculated = calculate_crc16_ascii(text[:-5])
        crc_valid = supplied_crc.upper() == crc_calculated

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
        frame_ok = crc_valid is not False

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
    """Auto-detect and parse either the old demo format or the company protocol."""
    if _looks_like_legacy_protocol(raw):
        legacy = parse_legacy_protocol_string(raw)
        legacy["parser"] = "legacy_demo"
        return legacy
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
    parsed = [parse_company_protocol_frame(frame, frame_name=frame_name) for frame in raw_frames]
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
        if p.get("parser") == "company_protocol":
            for key, value in p.get("reading", {}).items():
                if key in reading and value is not None:
                    reading[key] = value
            if p.get("crc_valid") is False:
                healths.append("warning")
            else:
                healths.append("healthy")
            continue

        if p.get("protocol") == "ALM" and p.get("fault_mode") != "none":
            faults.append(p["fault_mode"])
            reading["fault_mode"] = p["fault_mode"]
        elif p.get("protocol") == "ALM":
            reading["fault_mode"] = "none"

        field = p.get("field")
        if p.get("protocol") != "ALM" and field and field in reading:
            reading[field] = p["value"]

        if p.get("protocol") == "CMP":
            reading["compressor_on"] = p["status_code"] != "OF"

        healths.append(p.get("health", "healthy"))

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


# ─────────────────────────────────────────────
#  SAMPLE PROTOCOL STRINGS
# ─────────────────────────────────────────────

SAMPLE_NORMAL = """
*TOC024AA1401#
*AMB036AA1401#
*PRS085AA1401#
*DPS280AA1401#
*CMP350AA1401#
*FAN128AA1401#
*PWR595AA1401#
*SHT060AA1401#
*SCL050AA1401#
*COP320AA1401#
*EVP120AA1401#
*CND450AA1401#
*ALM000AA1401#
""".strip()

SAMPLE_REFRIGERANT_LEAK = """
*TOC024AA1401#
*AMB036AA1401#
*PRS052LL1401#
*DPS240LL1401#
*CMP350AA1401#
*FAN128AA1401#
*PWR650HH1401#
*SHT140HH1401#
*SCL020LL1401#
*COP240LL1401#
*EVP120AA1401#
*CND450AA1401#
*ALM001ER1401#
""".strip()

SAMPLE_HIGH_TEMP = """
*TOC032HH1300#
*AMB042HH1300#
*PRS090AA1300#
*DPS310HH1300#
*CMP420HH1300#
*FAN150HH1300#
*PWR820HH1300#
*SHT080AA1300#
*SCL040AA1300#
*COP280AA1300#
*EVP150HH1300#
*CND580HH1300#
*ALM000AA1300#
""".strip()


# ─────────────────────────────────────────────
#  TEST / DEMO
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    print("=" * 60)
    print("  VRF PROTOCOL PARSER — TEST RUN")
    print("=" * 60)

    for label, batch in [
        ("NORMAL OPERATION",   SAMPLE_NORMAL),
        ("REFRIGERANT LEAK",   SAMPLE_REFRIGERANT_LEAK),
        ("HIGH TEMP (1PM)",    SAMPLE_HIGH_TEMP),
    ]:
        print(f"\n{'─'*60}")
        print(f"  Scenario: {label}")
        print(f"{'─'*60}")
        result = parse_packet_batch(batch)
        print(f"  Health  : {result['health'].upper()}")
        print(f"  Faults  : {result['faults'] or 'None'}")
        print(f"  Parsed  : {result['successful']}/{result['total']}")
        print(f"\n  Unified Reading:")
        for k, v in result["reading"].items():
            if v is not None:
                print(f"    {k:<22}: {v}")

    print("\n" + "=" * 60)
    print("  SINGLE STRING TEST")
    print("=" * 60)
    test_strings = [
        "*TOC024AA1401#",
        "*PRS052LL0930#",
        "*ALM001ER1530#",
        "*BADFORMAT#",
        "*XYZ999ZZ0000#",
    ]
    for s in test_strings:
        r = parse_protocol_string(s)
        status = "✅" if r["parsed_ok"] else "❌"
        if r["parsed_ok"]:
            print(f"  {status} {s} → {r['protocol']}: {r['value']} {r['unit']} [{r['health']}]")
        else:
            print(f"  {status} {s} → ERROR: {r['error']}")
