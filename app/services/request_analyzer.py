from __future__ import annotations

from typing import Any, Dict, List

from app.models.schemas import AnalysisResult, ParseResult

from .explanation_engine import generate_request_explanations
from .helpers import coerce_float, coerce_int, ensure_list, extract_fields, get_nested, has_value, merge_messages, unique_strings
from .type_detector import detect_request_type

REQUEST_TOP_LEVEL_FIELDS = [
    "id",
    "test",
    "at",
    "tmax",
    "cur",
    "bcat",
    "badv",
    "wseat",
    "allimps",
    "ext",
]

APP_FIELDS = [
    "id",
    "name",
    "bundle",
    "domain",
    "storeurl",
    "cattax",
    "cat",
    "sectioncat",
    "pagecat",
    "ver",
    "privacypolicy",
    "paid",
    "publisher",
    "content",
    "keywords",
    "kwarray",
]

SITE_FIELDS = [
    "id",
    "name",
    "domain",
    "cattax",
    "cat",
    "sectioncat",
    "pagecat",
    "page",
    "ref",
    "search",
    "mobile",
    "privacypolicy",
    "publisher",
    "content",
    "keywords",
    "kwarray",
]

DEVICE_FIELDS = [
    "dnt",
    "ua",
    "sua",
    "ip",
    "ipv6",
    "devicetype",
    "make",
    "model",
    "os",
    "osv",
    "hwv",
    "h",
    "w",
    "ppi",
    "pxratio",
    "js",
    "geofetch",
    "flashver",
    "language",
    "langb",
    "carrier",
    "mccmnc",
    "connectiontype",
    "ifa",
    "didsha1",
    "didmd5",
    "dpidsha1",
    "dpidmd5",
    "macsha1",
    "macmd5",
    "lmt",
    "geo",
]

USER_FIELDS = [
    "id",
    "buyeruid",
    "yob",
    "gender",
    "keywords",
    "customdata",
    "geo",
    "data",
    "ext",
]

REGS_FIELDS = ["coppa", "ext.gdpr", "ext.us_privacy", "ext.gpp", "ext.gpp_sid"]
SOURCE_FIELDS = ["fd", "tid", "pchain", "schain"]
IMP_FIELDS = [
    "id",
    "metric",
    "displaymanager",
    "displaymanagerver",
    "instl",
    "tagid",
    "bidfloor",
    "bidfloorcur",
    "clickbrowser",
    "secure",
    "iframebuster",
    "exp",
    "rwdd",
    "ssai",
]
BANNER_FIELDS = ["w", "h", "format", "pos", "btype", "battr", "api", "topframe", "expdir", "vcm"]
VIDEO_FIELDS = [
    "mimes",
    "minduration",
    "maxduration",
    "protocols",
    "protocol",
    "w",
    "h",
    "startdelay",
    "placement",
    "plcmt",
    "linearity",
    "skip",
    "skipmin",
    "skipafter",
    "sequence",
    "battr",
    "maxextended",
    "minbitrate",
    "maxbitrate",
    "boxingallowed",
    "playbackmethod",
    "playbackend",
    "delivery",
    "pos",
    "api",
    "companionad",
    "companiontype",
    "rqddurs",
    "poddur",
    "podid",
    "podseq",
    "slotinpod",
    "mincpmpersec",
    "durfloors",
]
AUDIO_FIELDS = [
    "mimes",
    "minduration",
    "maxduration",
    "protocols",
    "startdelay",
    "sequence",
    "battr",
    "maxextended",
    "minbitrate",
    "maxbitrate",
    "delivery",
    "companionad",
    "api",
    "companiontype",
    "maxseq",
    "feed",
    "stitched",
    "nvol",
]
NATIVE_FIELDS = ["request", "ver", "api", "battr"]
PMP_FIELDS = ["private_auction", "deals"]
DEAL_FIELDS = ["id", "bidfloor", "bidfloorcur", "wseat", "wadomain", "at"]
CONTENT_FIELDS = [
    "id",
    "title",
    "series",
    "season",
    "url",
    "cattax",
    "cat",
    "prodq",
    "context",
    "qagmediarating",
    "keywords",
    "language",
    "langb",
]
NETWORK_FIELDS = ["id", "name", "domain"]
CHANNEL_FIELDS = ["id", "name", "domain"]


def _extract_imp_details(impressions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    details: List[Dict[str, Any]] = []
    for imp in impressions:
        item = extract_fields(imp, IMP_FIELDS)
        if isinstance(imp.get("banner"), dict):
            item["banner"] = extract_fields(imp["banner"], BANNER_FIELDS)
        if isinstance(imp.get("video"), dict):
            item["video"] = extract_fields(imp["video"], VIDEO_FIELDS)
        if isinstance(imp.get("audio"), dict):
            item["audio"] = extract_fields(imp["audio"], AUDIO_FIELDS)
        if isinstance(imp.get("native"), dict):
            item["native"] = extract_fields(imp["native"], NATIVE_FIELDS)
        if isinstance(imp.get("pmp"), dict):
            pmp_fields = extract_fields(imp["pmp"], PMP_FIELDS)
            deals = []
            for deal in ensure_list(imp["pmp"].get("deals")):
                if isinstance(deal, dict):
                    deals.append(extract_fields(deal, DEAL_FIELDS))
            pmp_fields["deals"] = deals
            item["pmp"] = pmp_fields
        details.append(item)
    return details


def _request_warnings(payload: Dict[str, Any], detection: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    impressions = ensure_list(payload.get("imp"))
    has_device_key = "device" in payload
    device = payload.get("device") if isinstance(payload.get("device"), dict) else {}

    if not impressions:
        warnings.append("Missing imp array. A valid OpenRTB bid request normally needs at least one impression object.")
    if not has_value(payload.get("id")):
        warnings.append("Request id is missing.")
    if payload.get("app") and payload.get("site"):
        warnings.append("Both app and site objects present. Inventory source is ambiguous.")
    if has_value(get_nested(payload, "site.keywords")) and has_value(get_nested(payload, "site.kwarray")):
        warnings.append("Site object includes both keywords and kwarray. OpenRTB 2.6 says only one should be present.")
    if has_value(get_nested(payload, "app.keywords")) and has_value(get_nested(payload, "app.kwarray")):
        warnings.append("App object includes both keywords and kwarray. OpenRTB 2.6 says only one should be present.")
    if not payload.get("app") and not payload.get("site"):
        warnings.append("Neither app nor site object is present, so the inventory source is unclear.")
    if not has_device_key:
        warnings.append("Device object is missing. Many buyers use device context heavily for eligibility and targeting.")
    elif not any(has_value(device.get(field_name)) for field_name in ["ua", "ip", "ifa"]):
        warnings.append("Device object present but missing UA/IP/IFA. Low addressability.")
    if has_value(device.get("language")) and has_value(device.get("langb")):
        warnings.append("Device object includes both language and langb. OpenRTB 2.6 says only one should be present.")
    if any(has_value(device.get(field_name)) for field_name in ["didsha1", "didmd5", "dpidsha1", "dpidmd5", "macsha1", "macmd5"]):
        warnings.append("Deprecated device identifier hashes are present. OpenRTB 2.6 marks these legacy fields as deprecated.")

    # Content object checks
    for source in ["site", "app"]:
        content = get_nested(payload, f"{source}.content")
        if isinstance(content, dict):
            if has_value(content.get("keywords")) and has_value(content.get("kwarray")):
                warnings.append(f"{source}.content includes both keywords and kwarray. Only one should be present.")
            if has_value(content.get("language")) and has_value(content.get("langb")):
                warnings.append(f"{source}.content includes both language and langb. Only one should be present.")

    # GPP (Global Privacy Platform) Validation
    regs = payload.get("regs") if isinstance(payload.get("regs"), dict) else {}
    gpp = regs.get("gpp") or get_nested(regs, "ext.gpp")
    gpp_sid = regs.get("gpp_sid") or get_nested(regs, "ext.gpp_sid")
    if has_value(gpp) or has_value(gpp_sid):
        if not (has_value(gpp) and has_value(gpp_sid)):
            warnings.append("Global Privacy Platform (GPP) configuration is partially specified: either gpp or gpp_sid is present, but both are recommended.")
        if has_value(gpp_sid) and not isinstance(gpp_sid, list):
            warnings.append("regs.ext.gpp_sid should be a non-empty array of integer section IDs.")

    # Structured User Agent (sua) Validation
    sua = device.get("sua")
    if sua is not None:
        if not isinstance(sua, dict):
            warnings.append("device.sua should be a structured UserAgent object.")
        else:
            browsers = sua.get("browsers")
            platform = sua.get("platform")
            mobile = sua.get("mobile")
            if browsers is None:
                warnings.append("device.sua is missing recommended 'browsers' list.")
            elif not isinstance(browsers, list):
                warnings.append("device.sua.browsers should be an array of BrandVersion objects.")
            else:
                for b_idx, browser in enumerate(browsers, start=1):
                    if not isinstance(browser, dict):
                        warnings.append(f"device.sua.browsers[{b_idx}] is not a valid BrandVersion object.")
                    else:
                        if not has_value(browser.get("brand")):
                            warnings.append(f"BrandVersion object in device.sua.browsers[{b_idx}] is missing required 'brand' attribute.")
                        if "version" in browser and not isinstance(browser.get("version"), list):
                            warnings.append(f"BrandVersion version in device.sua.browsers[{b_idx}] should be an array of strings.")
            
            if platform is None:
                warnings.append("device.sua is missing recommended 'platform' BrandVersion object.")
            elif not isinstance(platform, dict):
                warnings.append("device.sua.platform should be a BrandVersion object.")
            else:
                if not has_value(platform.get("brand")):
                    warnings.append("platform BrandVersion object in device.sua is missing required 'brand' attribute.")
                if "version" in platform and not isinstance(platform.get("version"), list):
                    warnings.append("platform BrandVersion version in device.sua should be an array of strings.")
            
            if mobile is None:
                warnings.append("device.sua is missing recommended 'mobile' flag.")
            elif coerce_int(mobile) not in (0, 1):
                warnings.append("device.sua.mobile should be an integer of 0 or 1.")

    for index, imp in enumerate(impressions, start=1):
        if not has_value(imp.get("id")):
            warnings.append("imp.id missing. DSP cannot map bid response to impression.")
        if not any(imp.get(media_type) for media_type in ["banner", "video", "native", "audio"]):
            warnings.append(f"imp[{index}] does not declare banner, video, native, or audio media.")
        if imp.get("video"):
            video = imp.get("video")
            if not isinstance(video, dict):
                warnings.append(f"imp[{index}].video should be a Video object.")
            else:
                missing_video_bits = []
                if not has_value(video.get("mimes")):
                    missing_video_bits.append("mimes")
                if not (has_value(video.get("minduration")) or has_value(video.get("maxduration"))):
                    missing_video_bits.append("duration")
                if not (has_value(video.get("protocols")) or has_value(video.get("protocol"))):
                    missing_video_bits.append("protocols")
                if missing_video_bits:
                    warnings.append("Video object missing important fields like mimes, duration, protocols.")
                if has_value(video.get("sequence")):
                    warnings.append("video.sequence is deprecated in OpenRTB 2.6.")
        if imp.get("banner"):
            banner = imp.get("banner")
            if not isinstance(banner, dict):
                warnings.append(f"imp[{index}].banner should be a Banner object.")
        if imp.get("native"):
            native = imp.get("native")
            if not isinstance(native, dict):
                warnings.append(f"imp[{index}].native should be a Native object.")
            elif not get_nested(native, "request"):
                warnings.append(f"imp[{index}].native is missing native.request content.")
        if imp.get("audio"):
            audio = imp.get("audio")
            if not isinstance(audio, dict):
                warnings.append(f"imp[{index}].audio should be an Audio object.")
            else:
                if not has_value(audio.get("mimes")):
                    warnings.append("Audio object missing required mimes field.")
                if has_value(audio.get("sequence")):
                    warnings.append("audio.sequence is deprecated in OpenRTB 2.6.")

    if detection["traffic_quality_notes"]["geo_status"] == "geo missing":
        warnings.append("Geo is missing from both device and user objects.")
    if detection["traffic_quality_notes"]["floor_status"] == "floor missing":
        warnings.append("No impression bid floor is declared.")

    return unique_strings(warnings)


def _request_errors(payload: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    impressions = ensure_list(payload.get("imp"))

    if "imp" not in payload:
        errors.append("Missing imp object. Bid request must contain at least one impression.")
    elif not impressions:
        errors.append("imp is present but empty. Bid request must contain at least one impression.")

    for imp in impressions:
        bidfloor = imp.get("bidfloor")
        if has_value(bidfloor) and coerce_float(bidfloor) is None:
            errors.append("bidfloor must be numeric.")

        video = imp.get("video")
        if isinstance(video, dict):
            if has_value(video.get("rqddurs")) and (has_value(video.get("minduration")) or has_value(video.get("maxduration"))):
                errors.append("Video object mixes rqddurs with minduration or maxduration. OpenRTB 2.6 makes these mutually exclusive.")

        audio = imp.get("audio")
        if isinstance(audio, dict):
            if has_value(audio.get("rqddurs")) and (has_value(audio.get("minduration")) or has_value(audio.get("maxduration"))):
                errors.append("Audio object mixes rqddurs with minduration or maxduration. OpenRTB 2.6 makes these mutually exclusive.")

        if imp.get("pmp"):
            for deal in ensure_list(get_nested(imp, "pmp.deals")):
                if isinstance(deal, dict) and not has_value(deal.get("id")):
                    errors.append("PMP deal missing deal ID.")

    return unique_strings(errors)


def _build_interview_points(detection: Dict[str, Any], warnings: List[str]) -> List[str]:
    points: List[str] = []
    points.append(f"This request appears to be {detection['inventory_source']}-based {detection['ad_format']} traffic.")
    if detection["ctv_label"] != "unlikely CTV":
        points.append("CTV signals are elevated due to app, device, or pod-style video cues.")
    points.append(f"Auction type is {detection['auction_model']}.")
    points.append(f"Deal path classification is {detection['deal_type']}.")
    points.append(f"Practical version guess is {detection['version_guess']}.")

    if warnings:
        points.append(warnings[0])

    return unique_strings(points)[:5]


def analyze_request(parse_result: ParseResult) -> AnalysisResult:
    if parse_result.parse_status != "parsed":
        return AnalysisResult(
            input_source=parse_result.input_source.model_dump(),
            input_type="unknown",
            parse_status=parse_result.parse_status,
            parsed_fields={
                "top_level": {},
                "app": {},
                "site": {},
                "device": {},
                "user": {},
                "regs": {},
                "source": {},
                "impressions": [],
            },
            summary={
                "request_id": None,
                "impression_count": 0,
                "inventory_source": "unknown",
                "ad_format": "unknown",
                "environment_guess": "unknown",
                "deal_type": "open auction",
                "auction_model": "unknown",
                "currencies": ["USD (assumed)"],
                "min_floor": None,
                "max_floor": None,
                "has_device": False,
                "has_user": False,
                "has_privacy_signal": False,
                "looks_valid": False,
            },
            human_explanations=[],
            inferred_signals={"validation_status": "invalid"},
            request_type_detection={},
            warnings=parse_result.warnings,
            errors=parse_result.errors,
            comparison_results={},
            interview_points=[],
            raw_payload=parse_result.parsed_payload,
        )

    payload = parse_result.analysis_payload or {}
    detection = detect_request_type(payload)
    impressions = [imp for imp in ensure_list(payload.get("imp")) if isinstance(imp, dict)]
    warnings = merge_messages(parse_result.warnings, _request_warnings(payload, detection))
    errors = merge_messages(parse_result.errors, _request_errors(payload))

    parsed_fields = {
        "top_level": extract_fields(payload, REQUEST_TOP_LEVEL_FIELDS),
        "app": extract_fields(payload.get("app", {}), APP_FIELDS) if payload.get("app") else {},
        "site": extract_fields(payload.get("site", {}), SITE_FIELDS) if payload.get("site") else {},
        "app_content": extract_fields(get_nested(payload, "app.content", {}), CONTENT_FIELDS) if get_nested(payload, "app.content") else {},
        "site_content": extract_fields(get_nested(payload, "site.content", {}), CONTENT_FIELDS) if get_nested(payload, "site.content") else {},
        "app_channel": extract_fields(get_nested(payload, "app.content.channel", {}), CHANNEL_FIELDS) if get_nested(payload, "app.content.channel") else {},
        "site_channel": extract_fields(get_nested(payload, "site.content.channel", {}), CHANNEL_FIELDS) if get_nested(payload, "site.content.channel") else {},
        "app_network": extract_fields(get_nested(payload, "app.content.network", {}), NETWORK_FIELDS) if get_nested(payload, "app.content.network") else {},
        "site_network": extract_fields(get_nested(payload, "site.content.network", {}), NETWORK_FIELDS) if get_nested(payload, "site.content.network") else {},
        "device": extract_fields(payload.get("device", {}), DEVICE_FIELDS) if payload.get("device") else {},
        "user": extract_fields(payload.get("user", {}), USER_FIELDS) if payload.get("user") else {},
        "regs": extract_fields(payload.get("regs", {}), REGS_FIELDS) if payload.get("regs") else {},
        "source": extract_fields(payload.get("source", {}), SOURCE_FIELDS) if payload.get("source") else {},
        "impressions": _extract_imp_details(impressions),
    }

    currencies = payload.get("cur") if isinstance(payload.get("cur"), list) else [payload.get("cur")] if payload.get("cur") else []
    floor_values = [coerce_float(imp.get("bidfloor")) for imp in impressions if coerce_float(imp.get("bidfloor")) is not None]
    floor_currency_values = [imp.get("bidfloorcur") for imp in impressions if has_value(imp.get("bidfloorcur"))]

    summary = {
        "request_id": payload.get("id"),
        "impression_count": len(impressions),
        "inventory_source": detection["inventory_source"],
        "ad_format": detection["ad_format"],
        "environment_guess": detection["environment_guess"],
        "deal_type": detection["deal_type"],
        "auction_model": detection["auction_model"],
        "currencies": currencies or unique_strings(floor_currency_values) or ["USD (assumed)"],
        "min_floor": min(floor_values) if floor_values else None,
        "max_floor": max(floor_values) if floor_values else None,
        "has_device": bool(payload.get("device")),
        "has_user": bool(payload.get("user")),
        "has_privacy_signal": detection["traffic_quality_notes"]["privacy_status"] == "privacy restricted",
        "looks_valid": not errors,
    }

    explanations = generate_request_explanations(payload, detection)
    interview_points = _build_interview_points(detection, warnings)

    return AnalysisResult(
        input_source=parse_result.input_source.model_dump(),
        input_type="request" if parse_result.detected_type == "bid_request" else "unknown",
        parse_status=parse_result.parse_status,
        parsed_fields=parsed_fields,
        summary=summary,
        human_explanations=explanations,
        inferred_signals={
            "ctv_score": detection["ctv_score"],
            "ctv_label": detection["ctv_label"],
            "ctv_reasons": detection["ctv_reasons"],
            "version_note": detection["version_note"],
            "modern_fields_found": detection["modern_fields_found"],
            "traffic_quality_notes": detection["traffic_quality_notes"],
            "validation_status": "invalid" if errors else "valid-ish",
        },
        request_type_detection=detection,
        warnings=warnings,
        errors=errors,
        comparison_results={},
        interview_points=interview_points,
        raw_payload=parse_result.parsed_payload,
    )
