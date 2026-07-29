from __future__ import annotations

from typing import Any, Dict, List

from .helpers import coerce_float, coerce_int, get_nested, has_value, unique_strings
from .rules_engine import auction_label, collect_impressions, collect_version_signals, detect_privacy_flags, is_probable_ctv_ua


def _detect_ad_format(impressions: List[Dict[str, Any]]) -> str:
    formats: List[str] = []
    for imp in impressions:
        if imp.get("banner"):
            formats.append("banner")
        if imp.get("video"):
            formats.append("video")
        if imp.get("native"):
            formats.append("native")
        if imp.get("audio"):
            formats.append("audio")

    distinct = unique_strings(formats)
    if not distinct:
        return "unknown"
    if len(distinct) == 1:
        return distinct[0]
    return "mixed"


# Sum of every signal weight in _ctv_score (2+2+3+3+2+2). Exposed so the UI
# renders the score against the real scale instead of hardcoding one.
CTV_SCORE_MAX = 14


def _ctv_score(payload: Dict[str, Any], impressions: List[Dict[str, Any]]) -> Dict[str, Any]:
    score = 0
    reasons: List[str] = []
    ua = (get_nested(payload, "device.ua", "") or "") + " " + (str(get_nested(payload, "device.sua", "")) or "")

    if any(isinstance(imp.get("video"), dict) for imp in impressions):
        score += 2
        reasons.append("Video impression object is present.")
    if payload.get("app"):
        score += 2
        reasons.append("App object is present.")
    if is_probable_ctv_ua(ua):
        score += 3
        reasons.append("User agent contains connected-TV style markers.")
    if coerce_int(get_nested(payload, "device.devicetype")) in {3, 6, 7}:
        score += 3
        reasons.append("Device type maps to connected TV or connected device.")

    pod_fields_found = False
    dur_floor_found = False
    for imp in impressions:
        video = imp.get("video")
        if isinstance(video, dict):
            if any(has_value(video.get(field_name)) for field_name in ["poddur", "podid", "podseq", "slotinpod"]):
                pod_fields_found = True
            if has_value(video.get("mincpmpersec")) or has_value(video.get("durfloors")):
                dur_floor_found = True

    if pod_fields_found:
        score += 2
        reasons.append("Pod-specific video fields are present.")
    if dur_floor_found:
        score += 2
        reasons.append("Duration floor fields are present.")

    if score >= 6:
        label = "likely CTV"
    elif score >= 3:
        label = "maybe CTV"
    else:
        label = "unlikely CTV"

    return {"score": score, "label": label, "reasons": reasons}


def detect_request_type(payload: Dict[str, Any]) -> Dict[str, Any]:
    impressions = collect_impressions(payload)
    inventory_source = "app" if payload.get("app") else "site" if payload.get("site") else "unknown"
    ad_format = _detect_ad_format(impressions)
    ctv = _ctv_score(payload, impressions)

    long_form_signal = False
    for imp in impressions:
        video = imp.get("video")
        if isinstance(video, dict):
            if any(has_value(video.get(field_name)) for field_name in ["poddur", "podid", "podseq", "slotinpod"]):
                long_form_signal = True
            if coerce_int(video.get("maxduration")) and coerce_int(video.get("maxduration")) >= 120:
                long_form_signal = True

    if ctv["label"] == "likely CTV":
        environment_guess = "CTV"
    elif ad_format == "audio":
        environment_guess = "audio stream"
    elif ad_format == "video" and long_form_signal:
        environment_guess = "OTT-like long-form video"
    elif inventory_source == "app":
        environment_guess = "mobile app"
    elif inventory_source == "site":
        environment_guess = "web"
    else:
        environment_guess = "unknown"

    pmp_imps = [imp for imp in impressions if isinstance(imp.get("pmp"), dict)]
    if any(imp["pmp"].get("private_auction") == 1 for imp in pmp_imps):
        deal_type = "private auction"
    elif pmp_imps:
        deal_type = "PMP available"
    else:
        deal_type = "open auction"

    auction_model = auction_label(payload.get("at"))
    version = collect_version_signals(payload)
    privacy_restricted, privacy_notes = detect_privacy_flags(payload)

    floor_values = [
        coerce_float(imp.get("bidfloor"))
        for imp in impressions
        if coerce_float(imp.get("bidfloor")) is not None
    ]
    floor_present = bool(floor_values)
    geo_present = bool(get_nested(payload, "device.geo") or get_nested(payload, "user.geo"))

    traffic_quality_notes = {
        "id_status": "ID present" if has_value(payload.get("id")) else "ID missing",
        "geo_status": "geo present" if geo_present else "geo missing",
        "floor_status": "floor present" if floor_present else "floor missing",
        "privacy_status": "privacy restricted" if privacy_restricted else "privacy signals not prominent",
        "privacy_notes": privacy_notes,
    }

    sentence_parts = [f"This appears to be an {inventory_source}-based" if inventory_source == "app" else f"This appears to be a {inventory_source}"]
    if inventory_source == "unknown":
        sentence_parts = ["This appears to be an OpenRTB-style payload"]

    if ad_format != "unknown":
        sentence_parts.append(f"{ad_format} request")
    else:
        sentence_parts.append("request")

    if ctv["label"] == "likely CTV":
        sentence_parts.append("with strong CTV signals")
    elif environment_guess == "OTT-like long-form video":
        sentence_parts.append("with OTT-like long-form video signals")

    if deal_type != "open auction":
        sentence_parts.append(f"and {deal_type.lower()} access")
    else:
        sentence_parts.append("for open auction traffic")

    request_type_sentence = " ".join(sentence_parts).replace("  ", " ").strip() + "."

    return {
        "inventory_source": inventory_source,
        "ad_format": ad_format,
        "environment_guess": environment_guess,
        "deal_type": deal_type,
        "auction_model": auction_model,
        "version_guess": version["label"],
        "version_confidence": version["confidence"],
        "version_note": version["note"],
        "modern_fields_found": version["modern_fields_found"],
        "traffic_quality_notes": traffic_quality_notes,
        "ctv_score": ctv["score"],
        "ctv_score_max": CTV_SCORE_MAX,
        "ctv_label": ctv["label"],
        "ctv_reasons": ctv["reasons"],
        "request_type_sentence": request_type_sentence,
    }
