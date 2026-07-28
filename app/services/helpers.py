from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Sequence


def ensure_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def get_nested(data: Any, path: str, default: Any = None) -> Any:
    current = data
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return default
    return current


def has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def unique_strings(values: Iterable[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            ordered.append(value)
    return ordered


def extract_fields(data: Dict[str, Any], field_paths: Sequence[str]) -> Dict[str, Any]:
    extracted: Dict[str, Any] = {}
    for path in field_paths:
        value = get_nested(data, path)
        if has_value(value):
            extracted[path] = value
    return extracted


def compact_json(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False)


def summarize_json_value(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return compact_json(value)
    return str(value)


def coerce_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def coerce_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def json_like_text(text: str) -> bool:
    stripped = text.lstrip()
    return stripped.startswith("{") or stripped.startswith("[")


def merge_messages(*collections: Iterable[str]) -> List[str]:
    combined: List[str] = []
    for collection in collections:
        for item in collection:
            if item and item not in combined:
                combined.append(item)
    return combined


def first_dict_item(payload: Any) -> Dict[str, Any] | None:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                return item
    return None
