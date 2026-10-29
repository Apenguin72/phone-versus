#!/usr/bin/env python3
"""Validate data/phones.json against data/schema.json.

The researcher's values are not rewritten. Failures are printed and the
process exits with status 1.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "data" / "schema.json"
DATA_PATH = ROOT / "data" / "phones.json"
CUTOFF = date(2023, 11, 1)
FOLDABLE = re.compile(r"(?i)\b(?:fold|flip)\b|摺疊|摺屏")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Unit sanity: catch a kg or mm value stored in a grams/inches/mAh field.
RANGES = {
    "battery_mAh": (100, 20000),
    "weight_g": (50, 800),
    "screen_inch": (3, 12),
    "refresh_hz": (30, 540),
    "official_endurance_hours": (1, 500),
}


def main(argv: list[str]) -> int:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    if "--self-test" in argv:
        return self_test(schema)
    records = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    errors = validate_records(records, schema)
    if errors:
        print(f"{DATA_PATH}: {len(errors)} problem(s)")
        for err in errors:
            print(f"- {err}")
        return 1
    core = sum(1 for rec in records if isinstance(rec, dict) and rec.get("core") is True)
    print(f"{DATA_PATH.name}: {len(records)} phones ok ({core} core)")
    return 0


def validate_records(records, schema) -> list[str]:
    if not isinstance(records, list):
        return ["root: expected a JSON array of phones"]
    errors: list[str] = []
    seen: dict[tuple, str] = {}
    for index, rec in enumerate(records):
        label = phone_label(rec, index)
        if not isinstance(rec, dict):
            errors.append(f"{label}: expected an object")
            continue
        for err in validate_phone(rec, schema):
            errors.append(f"{label}: {err}")
        key = (rec.get("brand"), rec.get("model"))
        if key in seen:
            errors.append(f"{label}: duplicate brand+model (also at {seen[key]})")
        else:
            seen[key] = label
    return errors


def phone_label(rec, index: int) -> str:
    if isinstance(rec, dict) and rec.get("brand") and rec.get("model"):
        return f"{rec['brand']} {rec['model']}"
    return f"record {index + 1}"


def validate_phone(phone: dict, schema: dict) -> list[str]:
    errors = validate_node(phone, schema, "phone")
    spec_fields = schema["properties"]["field_status"]["required"]
    status = phone.get("field_status") if isinstance(phone.get("field_status"), dict) else {}

    for field in spec_fields:
        if field not in phone:
            continue
        value = phone[field]
        field_status = status.get(field)
        if value is None and field_status != "unconfirmed":
            errors.append(
                f"{field} is null but field_status is {field_status!r}; "
                "null is only allowed when that field is unconfirmed"
            )
        if isinstance(value, str) and not value.strip():
            errors.append(f"{field} is blank")

    for field, (low, high) in RANGES.items():
        value = phone.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not low <= value <= high:
            errors.append(f"{field}={value} is outside the expected unit range {low}..{high}")

    announce = phone.get("announce_date")
    if isinstance(announce, str) and DATE_RE.fullmatch(announce):
        parsed = parse_date(announce)
        if parsed is None:
            errors.append("announce_date is not a real calendar date")
        elif parsed < CUTOFF:
            errors.append("announce_date must be on or after 2023-11-01 (global first launch)")
        elif phone.get("year") != parsed.year:
            errors.append(
                f"year {phone.get('year')!r} does not match announce_date {announce}"
            )

    checked = phone.get("checked_date")
    if isinstance(checked, str) and DATE_RE.fullmatch(checked) and parse_date(checked) is None:
        errors.append("checked_date is not a real calendar date")

    source = phone.get("source_url")
    if isinstance(source, str) and source:
        parsed_url = urlparse(source)
        if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc:
            errors.append("source_url must be an http(s) URL with a host")

    battery_url = phone.get("battery_source_url")
    battery_kind = phone.get("battery_source_type")
    has_battery_url = isinstance(battery_url, str) and bool(battery_url.strip())
    has_battery_kind = battery_kind not in (None, "")
    if has_battery_url != has_battery_kind:
        errors.append("battery_source_url and battery_source_type must be set together")
    if has_battery_url:
        parsed_battery = urlparse(battery_url)
        if parsed_battery.scheme not in ("http", "https") or not parsed_battery.netloc:
            errors.append("battery_source_url must be an http(s) URL with a host")

    model = phone.get("model")
    if isinstance(model, str) and FOLDABLE.search(model):
        errors.append("model looks foldable; this list is non-foldable phones only")

    notes = phone.get("notes", "")
    if "notes" in phone and not isinstance(notes, str):
        errors.append("notes must be a string when present")
    return errors


def parse_date(value: str):
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def validate_node(value, schema: dict, path: str) -> list[str]:
    if "oneOf" in schema:
        return validate_one_of(value, schema, path)

    errors: list[str] = []
    expected = schema.get("type")
    if expected is not None and not type_matches(value, expected):
        errors.append(f"{path}: expected {expected}, got {json_type(value)}")
        return errors

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} is not one of {schema['enum']}")

    if isinstance(value, str):
        pattern = schema.get("pattern")
        if pattern and value is not None and not re.fullmatch(pattern, value):
            # Nullable strings use a pattern that should not be applied to null.
            errors.append(f"{path}: {value!r} does not match {pattern}")
        min_length = schema.get("minLength")
        if min_length is not None and len(value) < min_length:
            errors.append(f"{path}: expected at least {min_length} characters")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} is below minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: {value} is above maximum {schema['maximum']}")

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                errors.append(f"{path}: missing {key}")
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in properties:
                    errors.append(f"{path}: unexpected property {key}")
        for key, subschema in properties.items():
            if key not in value:
                continue
            schema_type = subschema.get("type")
            if value[key] is None and schema_type is not None and type_matches(None, schema_type):
                continue
            errors.extend(validate_node(value[key], subschema, f"{path}.{key}"))

    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            errors.extend(validate_node(item, schema["items"], f"{path}[{index}]"))
    return errors


def validate_one_of(value, schema: dict, path: str) -> list[str]:
    matched = 0
    for option in schema["oneOf"]:
        if not validate_node(value, option, path):
            matched += 1
    if matched == 1:
        return []
    return [f"{path}: expected a string or an array of strings"]


def type_matches(value, expected) -> bool:
    if isinstance(expected, list):
        return any(type_matches(value, item) for item in expected)
    if expected == "null":
        return value is None
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    raise ValueError(f"unsupported schema type {expected}")


def json_type(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


SPEC_FIELDS = [
    "chip",
    "battery_mAh",
    "weight_g",
    "screen_inch",
    "resolution",
    "refresh_hz",
    "os_at_launch",
]

BASE_PHONE = {
    "brand": "Samsung",
    "model": "Validator Fixture",
    "core": True,
    "announce_date": "2024-01-15",
    "year": 2024,
    "chip": "Sample Chip",
    "battery_mAh": 4000,
    "weight_g": 180.0,
    "screen_inch": 6.5,
    "resolution": "2400x1080",
    "refresh_hz": 120,
    "os_at_launch": "Android 14",
    "official_endurance_hours": None,
    "source_url": "https://example.com/phone",
    "source_type": "official",
    "checked_date": "2026-10-29",
    "field_status": {field: "confirmed" for field in SPEC_FIELDS},
    "notes": "",
}


def fixture(**overrides):
    phone = json.loads(json.dumps(BASE_PHONE))
    status = overrides.pop("field_status", None)
    phone.update(overrides)
    if status is not None:
        phone["field_status"] = status
    return phone


def confirmed_status(**changes):
    status = {field: "confirmed" for field in SPEC_FIELDS}
    status.update(changes)
    return status


def self_test(schema: dict) -> int:
    cases = 0

    def expect_ok(name, records):
        nonlocal cases
        cases += 1
        errors = validate_records(records, schema)
        if errors:
            print(f"FAIL {name}: expected ok, got:")
            for err in errors:
                print(f"  {err}")
            return False
        return True

    def expect_fail(name, records, needle):
        nonlocal cases
        cases += 1
        errors = validate_records(records, schema)
        blob = "\n".join(errors)
        if needle not in blob:
            print(f"FAIL {name}: expected {needle!r} in:")
            for err in errors or ["<no errors>"]:
                print(f"  {err}")
            return False
        return True

    ok = True
    ok &= expect_ok("empty list", [])
    ok &= expect_ok("minimal phone", [fixture()])
    ok &= expect_ok("notes omitted", [fixture_without("notes")])
    ok &= expect_ok("null endurance", [fixture(official_endurance_hours=None)])
    ok &= expect_ok(
        "null chip when unconfirmed",
        [fixture(model="Null Chip", chip=None, field_status=confirmed_status(chip="unconfirmed"))],
    )
    ok &= expect_ok(
        "regulatory source",
        [fixture(model="Regulatory", source_type="regulatory")],
    )
    ok &= expect_ok(
        "optional detail fields",
        [fixture(
            model="Details",
            chip_variants=["Exynos (ROW)", "Snapdragon (USA)"],
            refresh_note="144 Hz only in game mode",
            battery_source_url="https://example.com/filing",
            battery_source_type="filing",
        )],
    )
    ok &= expect_ok(
        "chip variants as string",
        [fixture(model="String Variants", chip_variants="Kirin 9000 or Kirin 9010")],
    )
    ok &= expect_ok(
        "null refresh note and battery source",
        [fixture(model="Null Details", refresh_note=None, battery_source_url=None, battery_source_type=None, chip_variants=[])],
    )
    ok &= expect_fail(
        "battery source type without url",
        [fixture(model="Half Battery Source", battery_source_type="press")],
        "must be set together",
    )
    ok &= expect_fail(
        "bad battery source type",
        [fixture(model="Bad Battery Source", battery_source_type="wiki", battery_source_url="https://example.com/a")],
        "battery_source_type",
    )
    ok &= expect_fail(
        "chip variants number",
        [fixture(model="Bad Variants", chip_variants=3)],
        "chip_variants",
    )
    ok &= expect_ok("cutoff day", [fixture(model="Cutoff", announce_date="2023-11-01", year=2023)])
    ok &= expect_fail(
        "null battery when confirmed",
        [fixture(battery_mAh=None)],
        "battery_mAh is null",
    )
    ok &= expect_fail(
        "null when inferred",
        [fixture(refresh_hz=None, field_status=confirmed_status(refresh_hz="inferred"))],
        "refresh_hz is null",
    )
    ok &= expect_fail(
        "old announce date",
        [fixture(announce_date="2023-10-31", year=2023)],
        "2023-11-01",
    )
    ok &= expect_fail("bad brand", [fixture(brand="Sony")], "not one of")
    ok &= expect_fail("duplicate brand+model", [fixture(), fixture()], "duplicate brand+model")
    ok &= expect_fail("missing source", [fixture_without("source_url")], "missing source_url")
    ok &= expect_fail(
        "missing field status",
        [fixture(field_status={key: "confirmed" for key in SPEC_FIELDS if key != "os_at_launch"})],
        "missing os_at_launch",
    )
    ok &= expect_fail("battery string", [fixture(battery_mAh="5000 mAh")], "battery_mAh")
    ok &= expect_fail("foldable", [fixture(model="Galaxy Z Fold Demo")], "foldable")
    ok &= expect_fail("year mismatch", [fixture(year=2025)], "does not match")
    ok &= expect_fail("bad source type", [fixture(source_type="wiki")], "not one of")

    real = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    ok &= expect_ok("researcher dataset", real)

    if not ok:
        return 1
    print(f"self-test: {cases} cases ok")
    return 0


def fixture_without(key):
    phone = fixture()
    del phone[key]
    return phone


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
