#!/usr/bin/env python3
"""Validate data/phones.json against data/schema.json.

The researcher's values are not rewritten. Failures are printed and the
process exits with status 1.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "data" / "schema.json"
DATA_PATH = ROOT / "data" / "phones.json"
CHIP_PATH = ROOT / "data" / "chip_scores.json"
CAMERA_PATH = ROOT / "data" / "camera_specs.json"
PRICE_PATH = ROOT / "data" / "launch_prices.json"
IMAGE_DIR = ROOT / "images" / "phones"
CUTOFF = date(2023, 11, 1)
# Tournament field. main() and --self-test both reject a drift.
EXPECTED_PHONES = 91
EXPECTED_CORE = 91
ACCENT_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
# Exact brand|model field. Every one of these is a tournament entrant.
EXPECTED_KEYS = {
    "Apple|iPhone 16",
    "Apple|iPhone 16 Plus",
    "Apple|iPhone 16 Pro",
    "Apple|iPhone 16 Pro Max",
    "Apple|iPhone 16e",
    "Apple|iPhone 17",
    "Apple|iPhone 17 Pro",
    "Apple|iPhone 17 Pro Max",
    "Apple|iPhone 17e",
    "Apple|iPhone 18 Pro",
    "Apple|iPhone 18 Pro Max",
    "Apple|iPhone Air",
    "Google|Pixel 10",
    "Google|Pixel 10 Pro",
    "Google|Pixel 10 Pro XL",
    "Google|Pixel 10a",
    "Google|Pixel 11",
    "Google|Pixel 11 Pro",
    "Google|Pixel 11 Pro XL",
    "Google|Pixel 8a",
    "Google|Pixel 9",
    "Google|Pixel 9 Pro",
    "Google|Pixel 9 Pro XL",
    "Google|Pixel 9a",
    "Huawei|Mate 70",
    "Huawei|Mate 70 Pro",
    "Huawei|Mate 70 Pro+",
    "Huawei|Mate 80",
    "Huawei|Mate 80 Pro Max",
    "Huawei|Pura 70 Pro",
    "Huawei|Pura 70 Pro+",
    "Huawei|Pura 70 Ultra",
    "Huawei|Pura 80 Pro+",
    "Huawei|Pura 80 Ultra",
    "OPPO|Find X10",
    "OPPO|Find X10 E",
    "OPPO|Find X10 Pro Max",
    "OPPO|Find X7",
    "OPPO|Find X7 Ultra",
    "OPPO|Find X8",
    "OPPO|Find X8 Pro",
    "OPPO|Find X8 Ultra",
    "OPPO|Find X8s",
    "OPPO|Find X8s+",
    "OPPO|Find X9",
    "OPPO|Find X9 Pro",
    "OPPO|Find X9 Ultra",
    "OPPO|Find X9s",
    "OPPO|Find X9s Pro",
    "OPPO|Reno11",
    "OPPO|Reno11 Pro",
    "OPPO|Reno12",
    "OPPO|Reno12 Pro",
    "OPPO|Reno13",
    "OPPO|Reno13 Pro",
    "OPPO|Reno14",
    "OPPO|Reno14 Pro",
    "OPPO|Reno15",
    "OPPO|Reno15 Pro",
    "OPPO|Reno16",
    "OPPO|Reno16 Pro",
    "Samsung|Galaxy A35",
    "Samsung|Galaxy A36",
    "Samsung|Galaxy A37",
    "Samsung|Galaxy A55",
    "Samsung|Galaxy A56",
    "Samsung|Galaxy A57",
    "Samsung|Galaxy S24",
    "Samsung|Galaxy S24 FE",
    "Samsung|Galaxy S24 Ultra",
    "Samsung|Galaxy S24+",
    "Samsung|Galaxy S25",
    "Samsung|Galaxy S25 Edge",
    "Samsung|Galaxy S25 FE",
    "Samsung|Galaxy S25 Ultra",
    "Samsung|Galaxy S25+",
    "Samsung|Galaxy S26",
    "Samsung|Galaxy S26 FE",
    "Samsung|Galaxy S26 Ultra",
    "Samsung|Galaxy S26+",
    "Xiaomi|Xiaomi 14 Ultra",
    "Xiaomi|Xiaomi 15",
    "Xiaomi|Xiaomi 15 Pro",
    "Xiaomi|Xiaomi 15 Ultra",
    "Xiaomi|Xiaomi 15S Pro",
    "Xiaomi|Xiaomi 17",
    "Xiaomi|Xiaomi 17 Pro",
    "Xiaomi|Xiaomi 17 Pro Max",
    "Xiaomi|Xiaomi 17 Ultra",
    "Xiaomi|Xiaomi 18 Pro",
    "Xiaomi|Xiaomi 18 Pro Max",
}
FOLDABLE = re.compile(r"(?i)\b(?:fold|flip)\b|摺疊|摺屏")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
GSM_HOSTS = {"www.gsmarena.com", "gsmarena.com"}

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
    errors.extend(census_errors(records))
    errors.extend(asset_errors(records))
    errors.extend(camera_errors(records))
    errors.extend(price_errors(records))
    for line in unmatched_chips(records):
        print(f"unmatched chip: {line}")
    for line in missing_spec26(records):
        print(f"missing spec26_at_6w: {line}")
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
        # brand+model is the identity. There is no id field.
        key = identity_key(rec.get("brand"), rec.get("model"))
        if key in seen:
            errors.append(f"{label}: duplicate brand+model (also at {seen[key]})")
        else:
            seen[key] = label
    return errors


def identity_key(brand, model) -> tuple:
    def fold(value):
        if isinstance(value, str):
            return value.casefold().strip()
        return value

    return (fold(brand), fold(model))


def census_errors(records) -> list[str]:
    if not isinstance(records, list):
        return []
    core = sum(1 for rec in records if isinstance(rec, dict) and rec.get("core") is True)
    errors = []
    if len(records) != EXPECTED_PHONES:
        errors.append(f"expected {EXPECTED_PHONES} phones, found {len(records)}")
    if core != EXPECTED_CORE:
        errors.append(f"expected {EXPECTED_CORE} core phones, found {core}")
    if len(EXPECTED_KEYS) != EXPECTED_PHONES:
        errors.append(f"expected key list has {len(EXPECTED_KEYS)} entries, want {EXPECTED_PHONES}")
    found = set()
    for rec in records:
        if isinstance(rec, dict):
            found.add(f"{rec.get('brand')}|{rec.get('model')}")
    missing = sorted(EXPECTED_KEYS - found)
    extra = sorted(found - EXPECTED_KEYS)
    if missing:
        errors.append("missing tournament phones: " + ", ".join(missing))
    if extra:
        errors.append("unexpected phones: " + ", ".join(extra))
    if any(isinstance(rec, dict) and rec.get("core") is not True for rec in records):
        errors.append("every tournament phone must have core true")
    return errors


def slug_of(brand, model) -> str:
    text = f"{brand} {model}".lower().replace("+", " plus ").replace("＋", " plus ")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def normalize_chip(value: str) -> str:
    return "".join(value.lower().split())


def load_chip_scores():
    scores = json.loads(CHIP_PATH.read_text(encoding="utf-8"))
    if not isinstance(scores, dict) or not scores:
        raise ValueError("chip_scores.json must be an object")
    for key, entry in scores.items():
        if not isinstance(key, str) or not key or not isinstance(entry, dict):
            raise ValueError(f"bad chip score entry {key!r}")
        for field in ("spec26_at_6w", "spec26_6w_method", "spec26_6w_confidence", "spec26_6w_note"):
            if field not in entry:
                raise ValueError(f"bad chip score entry {key!r}: missing {field}")
        score = entry["spec26_at_6w"]
        if score is not None and (isinstance(score, bool) or not isinstance(score, (int, float))):
            raise ValueError(f"bad chip score entry {key!r}: spec26_at_6w")
        method = entry["spec26_6w_method"]
        note = entry["spec26_6w_note"]
        confidence = entry["spec26_6w_confidence"]
        if not isinstance(method, str) or not isinstance(note, str):
            raise ValueError(f"bad chip score entry {key!r}: spec26 method/note")
        if confidence is not None and not isinstance(confidence, str):
            raise ValueError(f"bad chip score entry {key!r}: spec26_6w_confidence")
    return scores


def resolve_chip(scores, chip: str):
    """Same match as the page: exact chip name, else the longest normalized substring."""
    if chip in scores:
        return scores[chip]
    norm = normalize_chip(chip)
    best = None
    best_len = -1
    for key, entry in scores.items():
        other = normalize_chip(key)
        if other and norm and (other in norm or norm in other) and len(other) > best_len:
            best = entry
            best_len = len(other)
    return best


def unmatched_chips(records) -> list[str]:
    if not isinstance(records, list):
        return []
    scores = load_chip_scores()
    unmatched = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        chip = rec.get("chip")
        label = phone_label(rec, 0)
        if not isinstance(chip, str) or not chip:
            unmatched.append(f"{label}: chip is missing")
            continue
        if resolve_chip(scores, chip) is None:
            unmatched.append(f"{label}: {chip}")
    return unmatched


def missing_spec26(records) -> list[str]:
    """Phones whose chip resolves but spec26_at_6w is null. Does not fail validation."""
    if not isinstance(records, list):
        return []
    scores = load_chip_scores()
    missing = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        chip = rec.get("chip")
        if not isinstance(chip, str) or not chip:
            continue
        entry = resolve_chip(scores, chip)
        if entry is None:
            continue
        score = entry.get("spec26_at_6w")
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            missing.append(f"{phone_label(rec, 0)}: {chip}")
    return missing


def asset_errors(records) -> list[str]:
    if not isinstance(records, list):
        return []
    errors = []
    seen_slugs = set()
    for rec in records:
        if not isinstance(rec, dict):
            continue
        label = phone_label(rec, 0)
        accent = rec.get("accent")
        if not isinstance(accent, str) or not ACCENT_RE.fullmatch(accent):
            errors.append(f"{label}: accent must be a #rrggbb color")
        slug = slug_of(rec.get("brand"), rec.get("model"))
        if slug in seen_slugs:
            errors.append(f"{label}: duplicate image slug {slug}")
        seen_slugs.add(slug)
        image = IMAGE_DIR / f"{slug}.webp"
        if not image.is_file():
            errors.append(f"{label}: missing cutout images/phones/{slug}.webp")
    return errors


def camera_errors(records) -> list[str]:
    if not isinstance(records, list):
        return []
    rows = json.loads(CAMERA_PATH.read_text(encoding="utf-8"))
    errors = []
    if not isinstance(rows, list):
        return ["camera_specs.json must be an array"]
    by_phone = {}
    for index, row in enumerate(rows):
        if (
            not isinstance(row, list)
            or len(row) != 5
            or not isinstance(row[0], str)
            or not isinstance(row[1], str)
            or isinstance(row[2], bool)
            or not isinstance(row[2], (int, float))
            or not isinstance(row[3], str)
            or isinstance(row[4], bool)
            or not isinstance(row[4], (int, float))
        ):
            errors.append(f"camera_specs.json row {index + 1} is not [brand, model, mp, rear, front]")
            continue
        key = (row[0], row[1])
        if key in by_phone:
            errors.append(f"camera_specs.json duplicate {row[0]} {row[1]}")
        by_phone[key] = row
    for rec in records:
        if not isinstance(rec, dict):
            continue
        key = (rec.get("brand"), rec.get("model"))
        if key not in by_phone:
            errors.append(f"{phone_label(rec, 0)}: missing camera_specs.json row")
    for brand, model in by_phone:
        if f"{brand}|{model}" not in EXPECTED_KEYS:
            errors.append(f"camera_specs.json unexpected phone {brand} {model}")
    return errors


def price_errors(records) -> list[str]:
    if not isinstance(records, list):
        return []
    rows = json.loads(PRICE_PATH.read_text(encoding="utf-8"))
    errors = []
    if not isinstance(rows, list):
        return ["launch_prices.json must be an array"]
    by_phone = {}
    for index, row in enumerate(rows):
        if (
            not isinstance(row, list)
            or len(row) != 4
            or not isinstance(row[0], str)
            or not isinstance(row[1], str)
            or isinstance(row[2], bool)
            or not isinstance(row[2], int)
            or isinstance(row[3], bool)
            or row[3] not in (0, 1)
        ):
            errors.append(
                f"launch_prices.json row {index + 1} is not [brand, model, launch_price_twd, converted]"
            )
            continue
        low, high = 1000, 200000
        if not low <= row[2] <= high:
            errors.append(
                f"launch_prices.json {row[0]} {row[1]}: launch_price_twd={row[2]} "
                f"is outside {low}..{high}"
            )
        key = (row[0], row[1])
        if key in by_phone:
            errors.append(f"launch_prices.json duplicate {row[0]} {row[1]}")
        by_phone[key] = row
    for rec in records:
        if not isinstance(rec, dict):
            continue
        key = (rec.get("brand"), rec.get("model"))
        if key not in by_phone:
            errors.append(f"{phone_label(rec, 0)}: missing launch_prices.json row")
    for brand, model in by_phone:
        if f"{brand}|{model}" not in EXPECTED_KEYS:
            errors.append(f"launch_prices.json unexpected phone {brand} {model}")
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

    for key in ("brand", "model"):
        value = phone.get(key)
        if isinstance(value, str) and value != value.strip():
            errors.append(f"{key} has leading or trailing whitespace")

    for field, (low, high) in RANGES.items():
        value = phone.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not low <= value <= high:
            errors.append(f"{field}={value} is outside the expected unit range {low}..{high}")

    announce = phone.get("announce_date")
    parsed_announce = None
    if isinstance(announce, str) and DATE_RE.fullmatch(announce):
        parsed_announce = parse_date(announce)
        if parsed_announce is None:
            errors.append("announce_date is not a real calendar date")
        elif parsed_announce < CUTOFF:
            errors.append("announce_date must be on or after 2023-11-01 (global first launch)")
        elif phone.get("year") != parsed_announce.year:
            errors.append(
                f"year {phone.get('year')!r} does not match announce_date {announce}"
            )

    checked = phone.get("checked_date")
    parsed_checked = None
    if isinstance(checked, str) and DATE_RE.fullmatch(checked):
        parsed_checked = parse_date(checked)
        if parsed_checked is None:
            errors.append("checked_date is not a real calendar date")
    if parsed_announce and parsed_checked and parsed_checked < parsed_announce:
        errors.append("checked_date is earlier than announce_date")

    source = phone.get("source_url")
    if isinstance(source, str) and source:
        if bad_http_url(source):
            errors.append("source_url must be an http(s) URL with a host")
        elif urlparse(source).netloc.lower() in GSM_HOSTS and phone.get("source_type") != "gsmarena":
            errors.append("gsmarena.com source_url requires source_type gsmarena")
        elif phone.get("source_type") == "gsmarena" and urlparse(source).netloc.lower() not in GSM_HOSTS:
            errors.append("source_type gsmarena requires a gsmarena.com source_url")

    errors.extend(validate_battery_source(phone))

    for image_url_field in ("image_url", "image_page_url"):
        image_url = phone.get(image_url_field)
        if isinstance(image_url, str) and image_url and bad_http_url(image_url):
            errors.append(f"{image_url_field} must be a remote http(s) URL, not a local image file")

    model = phone.get("model")
    if isinstance(model, str) and FOLDABLE.search(model):
        errors.append("model looks foldable; this list is non-foldable phones only")
    return errors


def bad_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme not in ("http", "https") or not parsed.netloc


def validate_battery_source(phone: dict) -> list[str]:
    """iPhones need a filing or press battery source. Other brands omit the pair."""
    battery_url = phone.get("battery_source_url")
    battery_kind = phone.get("battery_source_type")
    has_battery_url = isinstance(battery_url, str) and bool(battery_url.strip())
    if phone.get("brand") == "Apple":
        if not has_battery_url or battery_kind not in ("filing", "press"):
            return [
                "Apple phones must set battery_source_url and battery_source_type "
                "(filing or press) together; Apple does not publish mAh"
            ]
        if bad_http_url(battery_url):
            return ["battery_source_url must be an http(s) URL with a host"]
        return []
    if "battery_source_url" in phone or "battery_source_type" in phone:
        return [
            "battery_source_url and battery_source_type are iPhone-only; omit them on other brands"
        ]
    return []


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
        if pattern and not re.fullmatch(pattern, value):
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


# Same list as field_status.required. Kept in one place so fixtures cannot drift.
SPEC_FIELDS = list(
    json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))["properties"]["field_status"]["required"]
)

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
            brand="Apple",
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
        "null refresh note",
        [fixture(model="Null Details", refresh_note=None, chip_variants=[])],
    )
    ok &= expect_fail(
        "battery source type without url",
        [fixture(brand="Apple", model="Half Battery Source", battery_source_type="press")],
        "together",
    )
    ok &= expect_fail(
        "bad battery source type",
        [fixture(
            brand="Apple",
            model="Bad Battery Source",
            battery_source_type="wiki",
            battery_source_url="https://example.com/a",
        )],
        "battery_source_type",
    )
    ok &= expect_fail(
        "battery source on non-iphone",
        [fixture(
            model="Samsung Battery",
            battery_source_url="https://example.com/a",
            battery_source_type="press",
        )],
        "iPhone-only",
    )
    ok &= expect_fail(
        "iphone missing battery source",
        [fixture(brand="Apple", model="Bare iPhone")],
        "Apple phones must",
    )
    ok &= expect_fail(
        "null battery source",
        [fixture(brand="Apple", model="Null Battery", battery_source_url=None, battery_source_type=None)],
        "Apple phones must",
    )
    ok &= expect_fail(
        "chip variants number",
        [fixture(model="Bad Variants", chip_variants=3)],
        "chip_variants",
    )
    ok &= expect_ok(
        "remote image fields",
        [fixture(
            model="Remote Photo",
            image_url="https://example.com/phones/remote.jpg",
            image_page_url="https://example.com/phones/remote",
            image_note="官方產品圖",
            image_source="official",
        )],
    )
    ok &= expect_ok(
        "null image fields",
        [fixture(model="No Photo", image_url=None, image_page_url=None, image_note=None, image_source=None)],
    )
    ok &= expect_fail(
        "local image file",
        [fixture(model="Local Photo", image_url="photos/phone.jpg")],
        "image_url",
    )
    ok &= expect_fail(
        "local image page",
        [fixture(model="Local Page", image_page_url="photos/page.html")],
        "image_page_url",
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
    ok &= expect_fail(
        "duplicate brand+model ignoring case",
        [fixture(model="Case Phone"), fixture(model="case phone")],
        "duplicate brand+model",
    )
    ok &= expect_fail(
        "padded model",
        [fixture(model=" Padded ")],
        "whitespace",
    )
    ok &= expect_fail(
        "gsmarena type wrong host",
        [fixture(model="Wrong Host", source_type="gsmarena", source_url="https://example.com/phone")],
        "gsmarena.com",
    )
    ok &= expect_fail(
        "official type on gsmarena",
        [fixture(
            model="Arena Official",
            source_type="official",
            source_url="https://www.gsmarena.com/phone.php",
        )],
        "source_type gsmarena",
    )
    ok &= expect_fail(
        "checked before announce",
        [fixture(model="Early Check", announce_date="2024-06-01", year=2024, checked_date="2024-05-01")],
        "checked_date is earlier",
    )
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
    cases += 1
    census = census_errors(real) + asset_errors(real) + camera_errors(real) + price_errors(real)
    if census:
        ok = False
        print("FAIL researcher census:")
        for err in census:
            print(f"  {err}")
    for line in unmatched_chips(real):
        print(f"unmatched chip: {line}")
    for line in missing_spec26(real):
        print(f"missing spec26_at_6w: {line}")

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
