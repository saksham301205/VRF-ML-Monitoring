"""
Extract the company VRF communication workbook into a compact JSON catalog.

The project should not need Excel-specific libraries at runtime, so this script
reads the .xlsx package directly with the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


FRAME_RE = re.compile(r"^\*[^#\s].*#$")
HEX_CHARS = set("0123456789ABCDEFabcdef")


def q(ns: str, tag: str) -> str:
    return f"{{{NS[ns]}}}{tag}"


def col_to_idx(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    value = 0
    for ch in letters:
        value = value * 26 + ord(ch.upper()) - 64
    return value


def normalize_target(target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return f"xl/{target}"


def load_shared_strings(zip_file: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zip_file.namelist():
        return []

    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for si in root.findall(q("main", "si")):
        strings.append("".join(t.text or "" for t in si.iter(q("main", "t"))))
    return strings


def load_sheet_targets(zip_file: zipfile.ZipFile) -> list[dict[str, str]]:
    workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
    rel_root = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    rels = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rel_root.findall(q("pkgrel", "Relationship"))
    }

    sheets = []
    for sheet in workbook.find(q("main", "sheets")).findall(q("main", "sheet")):
        rel_id = sheet.attrib.get(q("rel", "id"))
        sheets.append(
            {
                "name": sheet.attrib["name"],
                "sheet_id": sheet.attrib.get("sheetId", ""),
                "path": normalize_target(rels[rel_id]),
            }
        )
    return sheets


def load_sheet_cells(
    zip_file: zipfile.ZipFile, path: str, shared_strings: list[str]
) -> tuple[str, dict[tuple[int, int], str]]:
    root = ET.fromstring(zip_file.read(path))
    dimension = root.find(q("main", "dimension"))
    dimension_ref = dimension.attrib.get("ref", "") if dimension is not None else ""
    sheet_data = root.find(q("main", "sheetData"))
    cells: dict[tuple[int, int], str] = {}

    if sheet_data is None:
        return dimension_ref, cells

    for row in sheet_data.findall(q("main", "row")):
        row_num = int(row.attrib.get("r", "0") or 0)
        for cell in row.findall(q("main", "c")):
            ref = cell.attrib.get("r", "")
            col_num = col_to_idx(ref)
            cell_type = cell.attrib.get("t")
            value = ""

            if cell_type == "inlineStr":
                value = "".join(t.text or "" for t in cell.iter(q("main", "t")))
            else:
                v = cell.find(q("main", "v"))
                if v is not None and v.text is not None:
                    raw = v.text
                    if cell_type == "s":
                        index = int(raw) if raw.isdigit() else -1
                        value = shared_strings[index] if 0 <= index < len(shared_strings) else raw
                    elif cell_type == "b":
                        value = "TRUE" if raw == "1" else "FALSE"
                    else:
                        value = raw

            if value != "":
                cells[(row_num, col_num)] = str(value).strip()

    return dimension_ref, cells


def as_int(value: str | None) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def normalize_description(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\r", "")).strip()


def extract_fields(cells: dict[tuple[int, int], str]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    rows = sorted({row for row, _ in cells})

    for row in rows:
        byte_no = cells.get((row, 1), "")
        length = cells.get((row, 2), "")
        left_param = cells.get((row, 3), "")
        left_desc = cells.get((row, 4), "")
        right_param = cells.get((row, 6), "")
        right_desc = cells.get((row, 7), "")

        if "Protocol_Data Byte No" in byte_no:
            continue
        if not byte_no and not length and not left_param and not right_param:
            continue

        byte_int = as_int(byte_no)
        length_int = as_int(length)

        if left_param or left_desc:
            fields.append(
                {
                    "row": row,
                    "group": "left",
                    "byte_no": byte_int,
                    "byte_no_raw": byte_no,
                    "length": length_int,
                    "length_raw": length,
                    "parameter": left_param,
                    "description": normalize_description(left_desc),
                    "notes": normalize_description(cells.get((row, 5), "")),
                }
            )

        has_right = right_param or right_desc
        differs_from_left = (right_param, right_desc) != (left_param, left_desc)
        if has_right and differs_from_left:
            fields.append(
                {
                    "row": row,
                    "group": "right",
                    "byte_no": byte_int,
                    "byte_no_raw": byte_no,
                    "length": length_int,
                    "length_raw": length,
                    "parameter": right_param,
                    "description": normalize_description(right_desc),
                    "notes": normalize_description(cells.get((row, 8), "")),
                }
            )

    return fields


def extract_patterns(cells: dict[tuple[int, int], str]) -> list[dict[str, Any]]:
    patterns: list[dict[str, Any]] = []
    for (row, col), value in sorted(cells.items()):
        if "* |" in value:
            patterns.append({"row": row, "cell_col": col, "pattern": normalize_description(value)})
    return patterns


def extract_examples(cells: dict[tuple[int, int], str]) -> list[dict[str, str]]:
    examples: list[dict[str, str]] = []
    for (row, col), value in sorted(cells.items()):
        text = value.strip()
        if len(text) > 600:
            continue
        if FRAME_RE.match(text) and all(ch in HEX_CHARS or ch in "*#+-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" for ch in text):
            examples.append({"row": str(row), "col": str(col), "frame": text})
    return examples


def extract_titles(cells: dict[tuple[int, int], str]) -> list[dict[str, Any]]:
    titles: list[dict[str, Any]] = []
    for row in sorted({row for row, _ in cells}):
        row_values = [cells.get((row, col), "") for col in range(1, 9)]
        nonempty = [value for value in row_values if value]
        if len(nonempty) == 1 and (
            "Frame" in nonempty[0] or "Command" in nonempty[0] or "Reply" in nonempty[0]
        ):
            titles.append({"row": row, "title": normalize_description(nonempty[0])})
    return titles


def extract_communication_sequence(cells: dict[tuple[int, int], str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    headers = [cells.get((5, col), "") for col in range(2, 10)]
    keys = [
        "sr_no",
        "frame_name",
        "purpose",
        "communication_line",
        "master",
        "slave",
        "interval",
        "communication_settings",
    ]

    for row in range(6, 200):
        values = [cells.get((row, col), "") for col in range(2, 10)]
        if not any(values):
            continue
        item = {key: normalize_description(value) for key, value in zip(keys, values)}
        item["row"] = str(row)
        item["headers"] = " | ".join(headers)
        rows.append(item)
    return rows


def extract_revision(cells: dict[tuple[int, int], str]) -> dict[str, Any]:
    return {
        "document": cells.get((1, 4), ""),
        "current_revision": cells.get((3, 2), ""),
        "rows": [
            {
                "revision": cells.get((row, 2), ""),
                "date": cells.get((row, 3), ""),
                "changes": normalize_description(cells.get((row, 4), "")),
                "done_by": cells.get((row, 5), ""),
            }
            for row in range(5, 28)
            if cells.get((row, 2)) or cells.get((row, 4))
        ],
    }


def extract_catalog(workbook_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(workbook_path) as zip_file:
        shared_strings = load_shared_strings(zip_file)
        sheet_targets = load_sheet_targets(zip_file)

        sheets: dict[str, Any] = {}
        communication_sequence: list[dict[str, str]] = []
        revision: dict[str, Any] = {}

        for sheet in sheet_targets:
            dimension, cells = load_sheet_cells(zip_file, sheet["path"], shared_strings)
            sheet_info = {
                "dimension": dimension,
                "titles": extract_titles(cells),
                "frame_patterns": extract_patterns(cells),
                "examples": extract_examples(cells),
                "fields": extract_fields(cells),
            }
            sheets[sheet["name"]] = sheet_info

            if sheet["name"] == "Communication Sequence":
                communication_sequence = extract_communication_sequence(cells)
            elif sheet["name"] == "Revision":
                revision = extract_revision(cells)

    return {
        "source_file": workbook_path.name,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "revision": revision,
        "communication_sequence": communication_sequence,
        "sheets": sheets,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract VRF protocol workbook to JSON.")
    parser.add_argument("workbook", type=Path, help="Path to VRF Communication protocol.xlsx")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/company_protocol_catalog.json"),
        help="Output JSON catalog path",
    )
    args = parser.parse_args()

    catalog = extract_catalog(args.workbook)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Extracted {len(catalog['sheets'])} sheets to {args.output}")


if __name__ == "__main__":
    main()
