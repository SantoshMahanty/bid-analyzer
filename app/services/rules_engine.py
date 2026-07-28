from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .helpers import coerce_int, ensure_list, get_nested, has_value

AUCTION_TYPE_LABELS = {
    1: "first-price",
    2: "second-price-like",
}

AUCTION_TYPE_EXPLANATIONS = {
    1: "First-price auction. The winning bidder usually pays exactly what it bid.",
    2: "Second-price-like auction. The winner may pay a clearing price instead of the full bid.",
}

DEVICE_TYPE_LABELS = {
    1: "mobile or tablet",
    2: "desktop",
    3: "connected TV",
    4: "phone",
    5: "tablet",
    6: "connected device",
    7: "set-top box",
}

CONNECTION_TYPE_LABELS = {
    0: "unknown",
    1: "Ethernet",
    2: "Wi-Fi",
    3: "cellular unknown generation",
    4: "2G",
    5: "3G",
    6: "4G",
    7: "5G",
}

VIDEO_PLACEMENT_LABELS = {
    1: "in-stream",
    2: "in-banner",
    3: "in-article",
    4: "in-feed",
    5: "interstitial or slider",
}

NO_BID_REASON_LABELS = {
    0: "unknown no-bid reason",
    1: "technical error",
    2: "invalid request",
    3: "known web spider",
    4: "suspected non-human traffic",
    5: "cloud, data center, or proxy traffic",
    6: "unsupported device",
    7: "blocked publisher or site",
    8: "unmatched user",
    9: "daily user cap reached",
    10: "daily domain cap reached",
}

MTYPE_LABELS = {
    1: "banner",
    2: "video",
    3: "audio",
    4: "native",
}

CTV_UA_MARKERS = [
    "roku",
    "tizen",
    "webos",
    "android tv",
    "fire tv",
    "appletv",
    "apple tv",
    "smarttv",
    "smart-tv",
    "aft",
]

POD_FIELDS = ["poddur", "podid", "podseq", "slotinpod"]
MODERN_VIDEO_FIELDS = POD_FIELDS + ["rqddurs", "plcmt", "mincpmpersec", "durfloors"]


def device_type_label(value: Any) -> str:
    numeric = coerce_int(value)
    if numeric is None:
        return "unknown device type"
    return DEVICE_TYPE_LABELS.get(numeric, f"device type {numeric}")


def connection_type_label(value: Any) -> str:
    numeric = coerce_int(value)
    if numeric is None:
        return "unknown connection type"
    return CONNECTION_TYPE_LABELS.get(numeric, f"connection type {numeric}")


def explain_auction_type(value: Any) -> str:
    numeric = coerce_int(value)
    if numeric is None:
        return "Auction model is not clearly declared."
    return AUCTION_TYPE_EXPLANATIONS.get(numeric, f"Auction type {numeric} is not mapped in the current rules.")


def auction_label(value: Any) -> str:
    numeric = coerce_int(value)
    if numeric is None:
        return "unknown"
    return AUCTION_TYPE_LABELS.get(numeric, "unknown")


def no_bid_reason_label(value: Any) -> str:
    numeric = coerce_int(value)
    if numeric is None:
        return "No-bid reason is not mapped."
    return NO_BID_REASON_LABELS.get(numeric, f"No-bid reason code {numeric}")


def markup_type_label(value: Any) -> str:
    numeric = coerce_int(value)
    if numeric is None:
        return "unknown markup type"
    return MTYPE_LABELS.get(numeric, f"markup type {numeric}")


def is_probable_ctv_ua(user_agent: str) -> bool:
    lowered = (user_agent or "").lower()
    return any(marker in lowered for marker in CTV_UA_MARKERS)


def collect_impressions(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [imp for imp in ensure_list(payload.get("imp")) if isinstance(imp, dict)]


def detect_privacy_flags(payload: Dict[str, Any]) -> Tuple[bool, List[str]]:
    notes: List[str] = []
    regs = payload.get("regs") if isinstance(payload.get("regs"), dict) else {}
    device = payload.get("device") if isinstance(payload.get("device"), dict) else {}

    if regs.get("coppa") == 1:
        notes.append("COPPA flag is enabled.")
    if get_nested(regs, "ext.gdpr") in (1, "1"):
        notes.append("GDPR signal is present.")
    if has_value(get_nested(regs, "ext.us_privacy")):
        notes.append("US privacy string is present.")
    if has_value(get_nested(regs, "ext.gpp")):
        notes.append("GPP string is present.")
    if device.get("lmt") == 1:
        notes.append("Limit ad tracking is enabled on the device.")

    return bool(notes), notes


def collect_version_signals(payload: Dict[str, Any]) -> Dict[str, Any]:
    imps = collect_impressions(payload)
    modern_fields_found: List[str] = []
    confidence = "low"

    for imp in imps:
        video = imp.get("video")
        if isinstance(video, dict):
            for field_name in MODERN_VIDEO_FIELDS:
                if has_value(video.get(field_name)):
                    modern_fields_found.append(field_name)

    modern_fields_found = sorted(set(modern_fields_found))
    if modern_fields_found:
        confidence = "medium"
        label = "likely 2.6-aligned"
        note = "Modern pod or duration-floor fields suggest newer OpenRTB video conventions."
    elif imps:
        label = "likely 2.5-compatible"
        confidence = "medium"
        note = "The payload mainly uses widely deployed 2.5-era fields and lacks stronger 2.6-only cues."
    else:
        label = "mixed / unclear"
        note = "There is not enough impression structure to infer a practical OpenRTB version style."

    if modern_fields_found and len(modern_fields_found) >= 3:
        confidence = "high"

    return {
        "label": label,
        "confidence": confidence,
        "modern_fields_found": modern_fields_found,
        "note": note,
    }


def video_placement_label(value: Any) -> str:
    numeric = coerce_int(value)
    if numeric is None:
        return "unknown placement"
    return VIDEO_PLACEMENT_LABELS.get(numeric, f"placement {numeric}")
