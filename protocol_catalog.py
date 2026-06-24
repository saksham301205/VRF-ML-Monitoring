"""
Protocol catalog loader for the company VRF communication workbook.

The catalog is generated from ``VRF Communication protocol.xlsx`` by
``tools/extract_protocol_catalog.py`` and checked into ``data/`` so the parser
can run without Excel dependencies.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(__file__).resolve().parent / "data" / "company_protocol_catalog.json"


@lru_cache(maxsize=1)
def load_protocol_catalog() -> dict[str, Any]:
    if not CATALOG_PATH.exists():
        return {
            "source_file": None,
            "generated_at": None,
            "revision": {},
            "communication_sequence": [],
            "sheets": {},
        }
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def list_protocol_frames() -> list[dict[str, Any]]:
    return load_protocol_catalog().get("communication_sequence", [])


def list_protocol_sheets() -> list[str]:
    return list(load_protocol_catalog().get("sheets", {}).keys())


def get_sheet_definition(sheet_name: str) -> dict[str, Any] | None:
    return load_protocol_catalog().get("sheets", {}).get(sheet_name)


def get_catalog_summary() -> dict[str, Any]:
    catalog = load_protocol_catalog()
    sheets = catalog.get("sheets", {})
    return {
        "source_file": catalog.get("source_file"),
        "generated_at": catalog.get("generated_at"),
        "revision": catalog.get("revision", {}).get("current_revision"),
        "frame_count": len(catalog.get("communication_sequence", [])),
        "sheet_count": len(sheets),
        "field_count": sum(len(sheet.get("fields", [])) for sheet in sheets.values()),
        "sheets": [
            {
                "name": name,
                "dimension": sheet.get("dimension"),
                "field_count": len(sheet.get("fields", [])),
                "frame_patterns": sheet.get("frame_patterns", []),
            }
            for name, sheet in sheets.items()
        ],
        "communication_sequence": catalog.get("communication_sequence", []),
    }

def candidate_sheets_for_frame(raw_frame: str, hint: str | None = None) -> list[str]:
    """
    Return possible workbook sheets for a raw serial frame.

    Some reply frames do not carry a fixed sheet identifier in a simple position,
    so this function may intentionally return more than one candidate. The parser
    decodes against every candidate and ranks the most informative match first.
    """
    if hint and get_sheet_definition(hint):
        return [hint]

    raw = raw_frame.strip()
    if not raw.startswith("*") or len(raw) < 4:
        return []

    content = raw[1:-1] if raw.endswith("#") else raw[1:]
    candidates: list[str] = []

    def add(*names: str) -> None:
        for name in names:
            if name not in candidates and get_sheet_definition(name):
                candidates.append(name)

    if content.startswith("PC"):
        data_type = raw[9:10].upper() if len(raw) > 9 else ""
        command = raw[7:9].upper() if len(raw) > 9 else ""
        if data_type == "E":
            add("IVRF Engineering Frame")
        elif data_type == "U":
            add("IVRF User Frame")
        elif command == "02":
            add("IVRF Configuration Download", "MVRF Configuration Download")
        else:
            add(
                "IVRF Engineering Frame",
                "IVRF User Frame",
                "IVRF Configuration Download",
                "IVRF Configuration Upload",
            )
    elif content.startswith("PB"):
        add("IVRF ODU Parameters", "IVRF ODU Parameters 147 bytes", "MVRF ODU Parameters", "DVRF ODU Parameters")
    elif content.startswith("PD"):
        add("IVRF Configuration Upload", "MVRF Configuration Upload")
    elif content.startswith("MO"):
        add("IVRF Configuration Download", "MVRF Configuration Download")
    elif content.startswith("MD"):
        add("IVRF Engineering Frame", "IVRF User Frame", "DVRF Engineering Frame", "DVRF User Frame", "MVRF Engineering Frame")
    elif content.startswith("EL"):
        add("IVRF Error Logging")
    elif content.startswith("DC"):
        add("DC, Moddbus, DA Config ")
    elif content.startswith("DT"):
        add("Date Time Config in DA")
    elif content.startswith("DR"):
        request_code = raw[7:9].upper() if len(raw) > 9 else ""
        if request_code == "01":
            add("Date Time Config in DA")
        elif request_code == "02":
            add("Data Acq Communication")
        else:
            add("Data Acq Communication", "Date Time Config in DA")
    elif content.startswith("DD"):
        add("Data Acq Communication")
    elif content.startswith("DA"):
        add("DC, Moddbus, DA Config ", "Date Time Config in DA", "Data Acq Communication")
    elif content.startswith("PMI"):
        add("Miscellaneous Info")
    elif content.startswith("B"):
        add("Start of BL Session", "Block Programming", "BL Status Polling", "End of BL Session")

    if not candidates:
        for frame in list_protocol_frames():
            name = frame.get("frame_name")
            if name and get_sheet_definition(name):
                candidates.append(name)

    return candidates
