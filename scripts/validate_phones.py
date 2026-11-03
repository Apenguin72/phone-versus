#!/usr/bin/env python3
"""Validate data/phones.json against data/schema.json.

Also checks chip_scores.json, camera_specs.json, and launch_prices.json
against the phone list. The researcher's values are not rewritten.
Failures are printed and the process exits with status 1. Lines that start
with "warning:", "unmatched chip:", or "missing spec26_at_6w:" do not fail.
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
# spec26_at_6w is a SPEC CPU 2026 INT score at 6 W, not a Geekbench score.
SPEC26_MAX = 30
MEASURED_METHODS = {"interpolated_points", "curve_at_6w", "peak_below_6w"}
ESTIMATED_METHODS = {"estimated_ratio", "equal_to_standard_part"}
BLOCKED_METHOD = "estimate_blocked_no_crowd_gb6"
CHIP_METHODS = MEASURED_METHODS | ESTIMATED_METHODS | {BLOCKED_METHOD}
CHIP_CONFIDENCE = {"measured", "medium", "low"}
REAR_RE = re.compile(r"^(?:\d+(?:\.\d+)?\+)*\d+(?:\.\d+)?MP$")
PRICE_MIN = 1000
PRICE_MAX = 200000
UNIT_FIELDS = (
    "battery_mAh",
    "weight_g",
    "screen_inch",
    "refresh_hz",
    "official_endurance_hours",
)
STATUS_VALUES = ["confirmed", "inferred", "unconfirmed"]
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

def main(argv: list[str]) -> int:
    try:
        schema, schema_dups = load_json(SCHEMA_PATH)
    except json.JSONDecodeError as exc:
        print(f"{SCHEMA_PATH}: invalid JSON ({exc})")
        return 1
    if schema_dups:
        print(f"{SCHEMA_PATH}: duplicate key(s): {', '.join(schema_dups)}")
        return 1
    if "--self-test" in argv:
        return self_test(schema)
    try:
        records, phone_dups = load_json(DATA_PATH)
    except json.JSONDecodeError as exc:
        print(f"{DATA_PATH}: invalid JSON ({exc})")
        return 1
    errors = schema_consistency_errors(schema)
    errors.extend(f"phones.json: duplicate key {key}" for key in phone_dups)
    errors.extend(validate_records(records, schema))
    errors.extend(census_errors(records))
    errors.extend(asset_errors(records))
    errors.extend(camera_errors(records))
    errors.extend(price_errors(records))
    scores, score_errors = read_chip_scores()
    errors.extend(score_errors)
    if isinstance(scores, dict):
        errors.extend(chip_score_problems(records, scores))
    for line in dataset_warnings(records, scores):
        print(line)
    if errors:
        print(f"{DATA_PATH}: {len(errors)} problem(s)")
        for err in errors:
            print(f"- {err}")
        return 1
    core = sum(1 for rec in records if isinstance(rec, dict) and rec.get("core") is True)
    print(f"{DATA_PATH.name}: {len(records)} phones ok ({core} core)")
    return 0


def load_json(path: Path):
    """Return (data, duplicate key names). Last value wins, same as json.loads."""
    duplicates = []

    def hook(pairs):
        seen = set()
        for key, _value in pairs:
            if key in seen:
                duplicates.append(key)
            else:
                seen.add(key)
        return dict(pairs)

    data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=hook)
    return data, duplicates


def schema_consistency_errors(schema) -> list[str]:
    """Catch a schema that no longer matches the rules the validator enforces."""
    if not isinstance(schema, dict):
        return ["schema.json: expected an object"]
    props = schema.get("properties")
    required = schema.get("required")
    if not isinstance(props, dict) or not isinstance(required, list):
        return ["schema.json: expected properties and required"]
    errors = []
    if "accent" not in required:
        errors.append("schema.json: accent must be required; every published phone has a body color")
    status = props.get("field_status")
    if not isinstance(status, dict):
        return errors + ["schema.json: field_status is missing"]
    status_req = status.get("required")
    status_props = status.get("properties")
    if not isinstance(status_req, list) or not isinstance(status_props, dict):
        errors.append("schema.json: field_status must list required keys and properties")
        return errors
    if set(status_req) != set(status_props):
        errors.append("schema.json: field_status required keys and properties differ")
    for field in status_req:
        if field not in props:
            errors.append(f"schema.json: field_status.{field} is not a phone property")
        elif field not in required:
            errors.append(f"schema.json: field_status.{field} is not required on a phone")
        sub = status_props.get(field)
        enum = sub.get("enum") if isinstance(sub, dict) else None
        if enum != STATUS_VALUES:
            errors.append(f"schema.json: field_status.{field} enum is not {STATUS_VALUES}")
    if "official_endurance_hours" in status_req:
        errors.append("schema.json: official_endurance_hours must stay out of field_status")
    for field in UNIT_FIELDS:
        sub = props.get(field)
        if not isinstance(sub, dict) or "minimum" not in sub or "maximum" not in sub:
            errors.append(f"schema.json: {field} is missing minimum and maximum")
            continue
        low, high = sub["minimum"], sub["maximum"]
        bounds_are_numbers = (
            not isinstance(low, bool)
            and not isinstance(high, bool)
            and isinstance(low, (int, float))
            and isinstance(high, (int, float))
        )
        if not bounds_are_numbers:
            errors.append(f"schema.json: {field} bounds must be numbers")
        elif low >= high:
            errors.append(f"schema.json: {field} minimum must be below maximum")
    return errors


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


def read_chip_scores():
    try:
        scores, duplicates = load_json(CHIP_PATH)
    except json.JSONDecodeError as exc:
        return None, [f"chip_scores.json: invalid JSON ({exc})"]
    errors = [f"chip_scores.json: duplicate key {key}" for key in duplicates]
    if not isinstance(scores, dict) or not scores:
        errors.append("chip_scores.json must be a non-empty object")
        return None, errors
    return scores, errors


def chip_score_problems(records, scores) -> list[str]:
    if not isinstance(scores, dict):
        return ["chip_scores.json must be an object"]
    errors = []
    for key, entry in scores.items():
        errors.extend(chip_entry_errors(key, entry))
    if isinstance(records, list):
        errors.extend(variant_chip_errors(records, scores))
    return errors


def chip_entry_errors(key, entry) -> list[str]:
    prefix = f"chip_scores.json {key!r}"
    if not isinstance(key, str) or not key or not isinstance(entry, dict):
        return [f"{prefix}: expected an object"]
    errors = []
    if entry.get("chip") != key:
        errors.append(f"{prefix}: chip field {entry.get('chip')!r} does not match the key")
    for field in ("spec26_at_6w", "spec26_6w_method", "spec26_6w_confidence", "spec26_6w_note"):
        if field not in entry:
            errors.append(f"{prefix}: missing {field}")
            return errors
    score = entry["spec26_at_6w"]
    method = entry["spec26_6w_method"]
    note = entry["spec26_6w_note"]
    confidence = entry["spec26_6w_confidence"]
    if score is not None and (isinstance(score, bool) or not isinstance(score, (int, float))):
        errors.append(f"{prefix}: spec26_at_6w must be a number or null")
    elif isinstance(score, (int, float)) and not isinstance(score, bool):
        if not 0 < score <= SPEC26_MAX:
            errors.append(f"{prefix}: spec26_at_6w={score} is outside 0..{SPEC26_MAX}")
        elif abs(score - round(float(score), 2)) > 1e-9:
            errors.append(f"{prefix}: spec26_at_6w={score} has more than 2 decimal places")
    if not isinstance(method, str) or method not in CHIP_METHODS:
        errors.append(f"{prefix}: spec26_6w_method {method!r} is not one of {sorted(CHIP_METHODS)}")
    if not isinstance(note, str) or not note.strip():
        errors.append(f"{prefix}: spec26_6w_note must be a non-empty string")
    if confidence is not None and confidence not in CHIP_CONFIDENCE:
        errors.append(
            f"{prefix}: spec26_6w_confidence {confidence!r} is not one of "
            f"{sorted(CHIP_CONFIDENCE)} or null"
        )
    if score is None:
        if confidence is not None or method != BLOCKED_METHOD:
            errors.append(
                f"{prefix}: a null spec26_at_6w requires confidence null and method {BLOCKED_METHOD}"
            )
    elif confidence == "measured" and method not in MEASURED_METHODS:
        errors.append(f"{prefix}: measured confidence does not match method {method!r}")
    elif confidence in {"medium", "low"} and method not in ESTIMATED_METHODS:
        errors.append(f"{prefix}: {confidence} confidence does not match method {method!r}")
    elif confidence is None:
        errors.append(f"{prefix}: spec26_6w_confidence is null but spec26_at_6w is {score}")
    source = entry.get("spec26_6w_source_url")
    if score is None:
        if source is not None and (not isinstance(source, str) or bad_http_url(source)):
            errors.append(f"{prefix}: spec26_6w_source_url must be an http(s) URL or null")
    elif not isinstance(source, str) or bad_http_url(source):
        errors.append(f"{prefix}: spec26_6w_source_url must be an http(s) URL when spec26_at_6w is set")
    checked = entry.get("checked_date")
    if not isinstance(checked, str) or DATE_RE.fullmatch(checked) is None or parse_date(checked) is None:
        errors.append(f"{prefix}: checked_date is not a YYYY-MM-DD date")
    if not isinstance(entry.get("variant_only"), bool):
        errors.append(f"{prefix}: variant_only must be a boolean")
    return errors


def referenced_chip_names(records) -> set[str]:
    names = set()
    for rec in records:
        if not isinstance(rec, dict):
            continue
        chip = rec.get("chip")
        if isinstance(chip, str) and chip:
            names.add(chip)
        variants = rec.get("chip_variants")
        if isinstance(variants, str):
            variants = [variants]
        if isinstance(variants, list):
            for item in variants:
                if isinstance(item, str) and item:
                    names.add(item)
    return names


def variant_chip_errors(records, scores) -> list[str]:
    errors = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        variants = rec.get("chip_variants")
        if isinstance(variants, str):
            variants = [variants]
        if not isinstance(variants, list):
            continue
        label = phone_label(rec, 0)
        for item in variants:
            if isinstance(item, str) and item and item not in scores:
                errors.append(f"{label}: chip_variants {item!r} is not a chip_scores.json key")
    return errors


def orphan_chip_warnings(records, scores) -> list[str]:
    refs = referenced_chip_names(records)
    phone_chips = sorted(
        {
            rec.get("chip")
            for rec in records
            if isinstance(rec, dict) and isinstance(rec.get("chip"), str) and rec.get("chip")
        }
    )
    warnings = []
    for key in sorted(name for name in scores if isinstance(name, str) and name not in refs):
        overlaps = []
        norm = normalize_chip(key)
        for chip in phone_chips:
            other = normalize_chip(chip)
            if norm and other and norm != other and (norm in other or other in norm):
                overlaps.append(chip)
        message = (
            "warning: chip_scores.json entry is not referenced by any phone chip "
            f"or chip_variants: {key}"
        )
        if overlaps:
            message += (
                "; normalized name overlaps "
                + ", ".join(overlaps)
                + " (exact chip match still wins)"
            )
        warnings.append(message)
    return warnings


def fuzzy_chip_warnings(records, scores) -> list[str]:
    warnings = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        chip = rec.get("chip")
        if not isinstance(chip, str) or not chip or chip in scores:
            continue
        if resolve_chip(scores, chip) is not None:
            warnings.append(
                f"warning: {phone_label(rec, 0)}: chip {chip!r} matched chip_scores.json only by substring"
            )
    return warnings


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


def unmatched_chips(records, scores) -> list[str]:
    if not isinstance(records, list) or not isinstance(scores, dict):
        return []
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


def missing_spec26(records, scores) -> list[str]:
    """Phones whose chip resolves but spec26_at_6w is null. Does not fail validation."""
    if not isinstance(records, list) or not isinstance(scores, dict):
        return []
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
        slug = slug_of(rec.get("brand"), rec.get("model"))
        if slug in seen_slugs:
            errors.append(f"{label}: duplicate image slug {slug}")
        seen_slugs.add(slug)
        image = IMAGE_DIR / f"{slug}.webp"
        if not image.is_file():
            errors.append(f"{label}: missing cutout images/phones/{slug}.webp")
    return errors


def camera_errors(records, rows=None) -> list[str]:
    if not isinstance(records, list):
        return []
    if rows is None:
        try:
            rows, duplicates = load_json(CAMERA_PATH)
        except json.JSONDecodeError as exc:
            return [f"camera_specs.json: invalid JSON ({exc})"]
        if duplicates:
            return [f"camera_specs.json: duplicate key {key}" for key in duplicates]
    if not isinstance(rows, list):
        return ["camera_specs.json must be an array"]
    errors = []
    by_phone = {}
    for index, row in enumerate(rows):
        problem = camera_row_problem(row)
        if problem:
            errors.append(f"camera_specs.json row {index + 1} {problem}")
            continue
        key = (row[0], row[1])
        if key in by_phone:
            errors.append(f"camera_specs.json duplicate {row[0]} {row[1]}")
        by_phone[key] = row
    errors.extend(coverage_errors(by_phone, records, "camera_specs.json"))
    return errors


def camera_row_problem(row) -> str | None:
    if (
        not isinstance(row, list)
        or len(row) != 5
        or not isinstance(row[0], str)
        or not isinstance(row[1], str)
        or isinstance(row[2], bool)
        or not isinstance(row[2], int)
        or not isinstance(row[3], str)
        or isinstance(row[4], bool)
        or not isinstance(row[4], int)
    ):
        return "is not [brand, model, mp, rear, front]"
    if row[0] != row[0].strip() or row[1] != row[1].strip():
        return "brand or model has leading or trailing whitespace"
    if not 1 <= row[2] <= 400:
        return f"main_mp={row[2]} is outside 1..400"
    if not 1 <= row[4] <= 200:
        return f"front_mp={row[4]} is outside 1..200"
    if not REAR_RE.fullmatch(row[3]):
        return f"rear {row[3]!r} is not a '+'-joined megapixel list ending in MP"
    leading = row[3][:-2].split("+", 1)[0]
    if float(leading) != row[2]:
        return f"main_mp={row[2]} does not match the leading rear camera in {row[3]!r}"
    return None


def price_errors(records, rows=None) -> list[str]:
    if not isinstance(records, list):
        return []
    if rows is None:
        try:
            rows, duplicates = load_json(PRICE_PATH)
        except json.JSONDecodeError as exc:
            return [f"launch_prices.json: invalid JSON ({exc})"]
        if duplicates:
            return [f"launch_prices.json: duplicate key {key}" for key in duplicates]
    if not isinstance(rows, list):
        return ["launch_prices.json must be an array"]
    errors = []
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
        if row[0] != row[0].strip() or row[1] != row[1].strip():
            errors.append(
                f"launch_prices.json {row[0]!r} {row[1]!r}: brand or model has leading or trailing whitespace"
            )
            continue
        if not PRICE_MIN <= row[2] <= PRICE_MAX:
            errors.append(
                f"launch_prices.json {row[0]} {row[1]}: launch_price_twd={row[2]} "
                f"is outside {PRICE_MIN}..{PRICE_MAX}"
            )
        key = (row[0], row[1])
        if key in by_phone:
            errors.append(f"launch_prices.json duplicate {row[0]} {row[1]}")
        by_phone[key] = row
    errors.extend(coverage_errors(by_phone, records, "launch_prices.json"))
    return errors


def coverage_errors(present, records, filename) -> list[str]:
    """Every phone needs a helper row, and every helper row needs a phone."""
    errors = []
    known = set()
    for rec in records:
        if not isinstance(rec, dict):
            continue
        brand, model = rec.get("brand"), rec.get("model")
        if not isinstance(brand, str) or not isinstance(model, str):
            continue
        key = (brand, model)
        if key in known:
            continue
        known.add(key)
        if key not in present:
            errors.append(f"{phone_label(rec, 0)}: missing {filename} row")
    for brand, model in present:
        if (brand, model) not in known:
            errors.append(f"{filename} row {brand} {model} is not in phones.json")
    return errors


def dataset_warnings(records, scores) -> list[str]:
    if not isinstance(records, list):
        return []
    if not isinstance(scores, dict):
        return note_status_warnings(records)
    lines = [f"unmatched chip: {line}" for line in unmatched_chips(records, scores)]
    lines.extend(f"missing spec26_at_6w: {line}" for line in missing_spec26(records, scores))
    lines.extend(fuzzy_chip_warnings(records, scores))
    lines.extend(orphan_chip_warnings(records, scores))
    lines.extend(note_status_warnings(records))
    return lines


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

    image_url = phone.get("image_url")
    if isinstance(image_url, str) and image_url.strip():
        image_source = phone.get("image_source")
        if not isinstance(image_source, str) or not image_source.strip():
            errors.append("image_url is set but image_source is blank")

    model = phone.get("model")
    if isinstance(model, str) and FOLDABLE.search(model):
        errors.append("model looks foldable; this list is non-foldable phones only")
    errors.extend(note_status_errors(phone))
    return errors


def note_status_errors(phone: dict) -> list[str]:
    """Fail when notes explicitly assign a status the field_status map does not."""
    notes = phone.get("notes")
    if not isinstance(notes, str) or not notes.strip():
        return []
    status = phone.get("field_status") if isinstance(phone.get("field_status"), dict) else {}
    errors = []

    def disagree(pattern, field, expected, claim):
        if re.search(pattern, notes, re.I) and status.get(field) != expected:
            errors.append(f"notes say {claim}, but field_status.{field} is {status.get(field)!r}")

    disagree(
        r"refresh\b[^.;\n]{0,80}\binferred\b",
        "refresh_hz",
        "inferred",
        "refresh is inferred",
    )
    disagree(
        r"refresh\b[^.;\n]{0,80}\bconfirmed\b",
        "refresh_hz",
        "confirmed",
        "refresh is confirmed",
    )
    disagree(
        r"refresh\b[^.;\n]{0,80}\bunconfirmed\b",
        "refresh_hz",
        "unconfirmed",
        "refresh is unconfirmed",
    )
    disagree(
        r"not maker-confirmed",
        "chip",
        "unconfirmed",
        "the chip is not maker-confirmed",
    )
    disagree(
        r"\b(?:one ui|coloros|hyperos|harmonyos|ios|android|os)[^.;\n]{0,60}\binferred\b"
        r"|\blaunch version inferred\b",
        "os_at_launch",
        "inferred",
        "the launch OS is inferred",
    )
    disagree(r"\bmAh confirmed\b", "battery_mAh", "confirmed", "battery mAh is confirmed")
    return errors


def note_status_warnings(records) -> list[str]:
    """Regional OS notes that disagree with a confirmed HarmonyOS value. Does not fail."""
    if not isinstance(records, list):
        return []
    warnings = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        notes = rec.get("notes")
        os_name = rec.get("os_at_launch")
        status = rec.get("field_status") if isinstance(rec.get("field_status"), dict) else {}
        if (
            isinstance(notes, str)
            and re.search(r"\bEMUI\b", notes)
            and isinstance(os_name, str)
            and "HarmonyOS" in os_name
            and status.get("os_at_launch") == "confirmed"
        ):
            warnings.append(
                f"warning: {phone_label(rec, 0)}: notes say international units ship EMUI, "
                f"but os_at_launch is confirmed {os_name}"
            )
    return warnings


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
    "accent": "#5b7cfa",
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


def sample_chip(name, **overrides):
    entry = {
        "chip": name,
        "spec26_at_6w": 5.0,
        "spec26_6w_method": "curve_at_6w",
        "spec26_6w_confidence": "measured",
        "spec26_6w_note": "measured curve",
        "spec26_6w_source_url": "https://example.com/score",
        "checked_date": "2026-10-30",
        "variant_only": False,
    }
    entry.update(overrides)
    return entry


def self_test(schema: dict) -> int:
    consistency = schema_consistency_errors(schema)
    if consistency:
        print("FAIL schema consistency:")
        for err in consistency:
            print(f"  {err}")
        return 1
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

    def expect_clean(name, errors):
        nonlocal cases
        cases += 1
        if errors:
            print(f"FAIL {name}: expected ok, got:")
            for err in errors:
                print(f"  {err}")
            return False
        return True

    def expect_blob(name, errors, needle):
        nonlocal cases
        cases += 1
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
        [fixture(model="Local Photo", image_url="photos/phone.jpg", image_source="local")],
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
    ok &= expect_fail("missing accent", [fixture_without("accent")], "missing accent")
    ok &= expect_fail("bad accent", [fixture(accent="red")], "accent")
    ok &= expect_fail(
        "battery below minimum",
        [fixture(battery_mAh=schema["properties"]["battery_mAh"]["minimum"] - 1)],
        "below minimum",
    )
    ok &= expect_fail(
        "weight above maximum",
        [fixture(weight_g=schema["properties"]["weight_g"]["maximum"] + 1)],
        "above maximum",
    )
    ok &= expect_fail(
        "note contradicts refresh status",
        [fixture(model="Note Clash", notes="refresh 60 Hz inferred")],
        "refresh is inferred",
    )
    ok &= expect_ok(
        "note agrees refresh inferred",
        [fixture(
            model="Note Agree",
            notes="refresh 60 Hz inferred",
            refresh_hz=60,
            field_status=confirmed_status(refresh_hz="inferred"),
        )],
    )
    ok &= expect_fail("id field", [fixture(id="phone-1")], "unexpected property id")
    ok &= expect_fail(
        "image without source",
        [fixture(model="Uncredited", image_url="https://example.com/a.jpg")],
        "image_source",
    )

    sample = [fixture()]
    ok &= expect_clean(
        "camera row",
        camera_errors(sample, rows=[["Samsung", "Validator Fixture", 48, "48+12MP", 12]]),
    )
    ok &= expect_blob(
        "camera rear format",
        camera_errors(sample, rows=[["Samsung", "Validator Fixture", 48, "48 MP", 12]]),
        "rear",
    )
    ok &= expect_blob(
        "camera leading mp",
        camera_errors(sample, rows=[["Samsung", "Validator Fixture", 50, "48MP", 12]]),
        "leading",
    )
    ok &= expect_blob(
        "unknown camera phone",
        camera_errors(
            sample,
            rows=[
                ["Samsung", "Validator Fixture", 48, "48MP", 12],
                ["Sony", "X", 48, "48MP", 12],
            ],
        ),
        "not in phones.json",
    )
    ok &= expect_blob(
        "price out of range",
        price_errors(sample, rows=[["Samsung", "Validator Fixture", 50, 0]]),
        "launch_price_twd",
    )
    ok &= expect_clean(
        "chip entry",
        chip_score_problems(sample, {"Sample Chip": sample_chip("Sample Chip")}),
    )
    mismatch = chip_score_problems(
        sample,
        {"Sample Chip": sample_chip("Other", spec26_at_6w=4000)},
    )
    ok &= expect_blob("chip key mismatch", mismatch, "does not match the key")
    ok &= expect_blob("geekbench-sized score", mismatch, "outside")
    orphan_warnings = orphan_chip_warnings(
        sample,
        {"Sample Chip": sample_chip("Sample Chip"), "Old Kirin": sample_chip("Old Kirin")},
    )
    ok &= expect_blob("orphan chip", orphan_warnings, "Old Kirin")
    ok &= expect_blob(
        "emui note",
        note_status_warnings([
            fixture(
                brand="Huawei",
                model="Pura Demo",
                os_at_launch="HarmonyOS 5.1",
                notes="international units ship EMUI; China HarmonyOS shown",
            )
        ]),
        "EMUI",
    )

    real, phone_dups = load_json(DATA_PATH)
    ok &= expect_ok("researcher dataset", real)
    cases += 1
    scores, score_file_errors = read_chip_scores()
    census = census_errors(real) + asset_errors(real) + camera_errors(real) + price_errors(real)
    census.extend(f"phones.json: duplicate key {key}" for key in phone_dups)
    census.extend(score_file_errors)
    if isinstance(scores, dict):
        census.extend(chip_score_problems(real, scores))
    if census:
        ok = False
        print("FAIL researcher census:")
        for err in census:
            print(f"  {err}")
    for line in dataset_warnings(real, scores):
        print(line)

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
