from __future__ import annotations

from typing import Any, Dict, List

from .helpers import coerce_float, ensure_list, get_nested, has_value, unique_strings
from .rules_engine import connection_type_label, device_type_label, explain_auction_type, markup_type_label, no_bid_reason_label, video_placement_label


def generate_request_explanations(payload: Dict[str, Any], detection: Dict[str, Any]) -> List[str]:
    explanations: List[str] = []
    impressions = ensure_list(payload.get("imp"))
    request_currencies = ensure_list(payload.get("cur")) or ["USD"]

    if has_value(payload.get("id")):
        explanations.append(f"Request id `{payload['id']}` helps marketplaces and bidders correlate this auction opportunity across logs.")

    if has_value(payload.get("at")):
        explanations.append(f"at = {payload['at']} -> {explain_auction_type(payload.get('at'))}")

    if has_value(payload.get("tmax")):
        explanations.append(f"tmax = {payload['tmax']} means the exchange expects a response within roughly {payload['tmax']} milliseconds.")

    if payload.get("app"):
        bundle = get_nested(payload, "app.bundle")
        app_name = get_nested(payload, "app.name")
        if has_value(bundle):
            explanations.append(f"app.bundle = `{bundle}` identifies the app where the ad opportunity is available.")
        elif has_value(app_name):
            explanations.append(f"app.name = `{app_name}` indicates the inventory is coming from an application context.")

    if payload.get("site"):
        domain = get_nested(payload, "site.domain")
        page = get_nested(payload, "site.page")
        if has_value(domain):
            explanations.append(f"site.domain = `{domain}` identifies the website or publisher domain for this inventory.")
        if has_value(page):
            explanations.append("site.page shows the page URL where the ad opportunity was observed.")

    if get_nested(payload, "device.devicetype") is not None:
        explanations.append(
            f"device.devicetype = {get_nested(payload, 'device.devicetype')} suggests a {device_type_label(get_nested(payload, 'device.devicetype'))} environment."
        )

    if has_value(get_nested(payload, "device.connectiontype")):
        explanations.append(
            f"device.connectiontype = {get_nested(payload, 'device.connectiontype')} indicates {connection_type_label(get_nested(payload, 'device.connectiontype'))} connectivity."
        )

    if has_value(get_nested(payload, "device.dnt")):
        explanations.append(f"device.dnt = {get_nested(payload, 'device.dnt')} carries the browser Do Not Track signal from the device context.")

    if has_value(get_nested(payload, "device.sua")):
        explanations.append("device.sua is present. OpenRTB 2.6 treats structured user agent data as more accurate than a frozen or reduced ua string.")

    if not has_value(get_nested(payload, "device.ifa")) and payload.get("app"):
        explanations.append("device.ifa is missing. Some buyers may bid more conservatively when app-level advertising identifiers are absent.")

    if get_nested(payload, "regs.ext.gdpr") in (1, "1"):
        explanations.append("regs.ext.gdpr = 1 indicates the request carries a GDPR applicability signal.")

    if has_value(get_nested(payload, "regs.ext.us_privacy")):
        explanations.append("regs.ext.us_privacy is present, so buyers may apply US privacy handling before bidding.")

    if get_nested(payload, "source.schain"):
        explanations.append("source.schain is present, which helps buyers understand the supply path and intermediaries.")

    if get_nested(payload, "source.pchain"):
        explanations.append("source.pchain is present, which can help with supply chain transparency and troubleshooting.")

    if detection.get("deal_type") == "private auction":
        explanations.append("pmp.private_auction = 1 means the opportunity may be restricted to invited buyers or deal participants.")
    elif detection.get("deal_type") == "PMP available":
        explanations.append("PMP objects are present, so private or preferred deal paths may be available alongside broader auction access.")

    for imp in impressions[:3]:
        imp_id = imp.get("id", "unknown")
        floor = coerce_float(imp.get("bidfloor"))
        if floor is not None:
            currency = imp.get("bidfloorcur") or request_currencies[0]
            explanations.append(f"imp[{imp_id}].bidfloor = {floor:g} means buyers are expected to bid at or above {floor:g} CPM in {currency}.")

        video = imp.get("video")
        if isinstance(video, dict) and has_value(video.get("placement")):
            explanations.append(
                f"video.placement = {video.get('placement')} points to a {video_placement_label(video.get('placement'))} style video opportunity."
            )
        if has_value(imp.get("ssai")):
            explanations.append(f"imp[{imp_id}].ssai = {imp.get('ssai')} signals the degree of server-side ad insertion involved in the stream.")

    if detection.get("version_guess"):
        explanations.append(
            f"Version guess: {detection['version_guess']} with {detection['version_confidence']} confidence. {detection['version_note']}"
        )

    if detection.get("ctv_score", 0) > 0:
        explanations.append(
            f"CTV score = {detection['ctv_score']} ({detection['ctv_label']}). This reflects the combined presence of video, device, app, and pod-related signals."
        )

    return unique_strings(explanations)


def generate_response_explanations(payload: Dict[str, Any], summary: Dict[str, Any]) -> List[str]:
    explanations: List[str] = []
    seatbids = ensure_list(payload.get("seatbid"))

    if has_value(payload.get("id")):
        explanations.append(f"Response id `{payload['id']}` should usually match the originating request id for straightforward troubleshooting.")

    if has_value(payload.get("nbr")):
        explanations.append(f"nbr = {payload['nbr']} indicates a no-bid style response: {no_bid_reason_label(payload.get('nbr'))}.")
    elif payload.get("seatbid") == []:
        explanations.append("seatbid = [] is a well-formed no-bid response shape in OpenRTB 2.6, even without an nbr code.")

    explanations.append(
        f"The response contains {summary.get('seat_count', 0)} seatbid objects and {summary.get('bid_count', 0)} total bids."
    )

    if has_value(payload.get("cur")):
        explanations.append(f"cur = `{payload['cur']}` sets the currency used by bid prices in this response.")

    for seatbid in seatbids[:2]:
        seat = seatbid.get("seat") or "unknown seat"
        bids = ensure_list(seatbid.get("bid"))
        if not bids:
            explanations.append(f"Seat `{seat}` is present but did not return any bid objects.")
        for bid in bids[:2]:
            if not isinstance(bid, dict):
                explanations.append("A seatbid contains a malformed (non-object) bid entry.")
                continue
            impid = bid.get("impid", "unknown imp")
            price = bid.get("price")
            if price is not None:
                explanations.append(f"Bid `{bid.get('id', 'unknown')}` maps to impression `{impid}` at price {price}.")
            if has_value(bid.get("dealid")):
                explanations.append(f"dealid = `{bid['dealid']}` shows this bid is tied to a private marketplace deal.")
            if has_value(bid.get("mtype")):
                explanations.append(f"mtype = {bid.get('mtype')} declares this bid as {markup_type_label(bid.get('mtype'))} creative markup.")
            if not has_value(bid.get("adomain")):
                explanations.append("adomain is missing on one or more bids. Many integrations treat advertiser domain as important creative metadata.")
            if not has_value(bid.get("adm")) and not has_value(bid.get("nurl")) and not has_value(bid.get("burl")):
                explanations.append("The bid lacks adm, nurl, and burl, so the response may not contain enough win markup or tracking detail to serve cleanly.")

    if summary.get("creative_metadata") == "thin":
        explanations.append("Creative metadata looks thin overall, which can make debugging creative approval or rendering issues harder.")

    return unique_strings(explanations)
