from __future__ import annotations

import gzip
from typing import Optional

from fastapi import UploadFile

from app.models.schemas import InputMetadata, NormalizedInput

from .helpers import json_like_text
from .url_fetcher import fetch_url_content


def _decode_bytes(content: bytes) -> tuple[str, list[str]]:
    notes = []
    raw = content
    if raw[:2] == b"\x1f\x8b":
        try:
            raw = gzip.decompress(raw)
            notes.append("Detected and decompressed gzip content.")
        except OSError:
            notes.append("The file looked gzipped but could not be decompressed cleanly.")

    try:
        return raw.decode("utf-8"), notes
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace"), notes + ["Some bytes could not be decoded cleanly and were replaced."]


async def normalize_input(
    raw_text: Optional[str] = None,
    upload_file: Optional[UploadFile] = None,
    source_url: Optional[str] = None,
) -> NormalizedInput:
    notes: list[str] = []
    choices = [
        bool(raw_text and raw_text.strip()),
        bool(upload_file and upload_file.filename),
        bool(source_url and source_url.strip()),
    ]
    if sum(choices) > 1:
        notes.append("Multiple input sources were provided. Raw text takes priority over file upload, and file upload takes priority over URL.")

    if raw_text and raw_text.strip():
        normalized_text = raw_text.strip()
        if not json_like_text(normalized_text):
            notes.append("Input does not start with a JSON object or array marker.")
        metadata = InputMetadata(
            source_type="raw_text",
            content_length=len(normalized_text),
            parse_status="normalized",
            notes=notes,
        )
        return NormalizedInput(
            input_source=metadata,
            original_text=raw_text,
            normalized_text=normalized_text,
            raw_bytes_size=len(raw_text.encode("utf-8")),
        )

    if upload_file and upload_file.filename:
        content = await upload_file.read()
        decoded_text, decode_notes = _decode_bytes(content)
        normalized_text = decoded_text.strip()
        metadata = InputMetadata(
            source_type="file",
            file_name=upload_file.filename,
            content_length=len(normalized_text),
            parse_status="normalized",
            content_type=upload_file.content_type,
            notes=notes + decode_notes,
        )
        if not json_like_text(normalized_text):
            metadata.notes.append("Uploaded file content does not look like JSON text.")
        return NormalizedInput(
            input_source=metadata,
            original_text=decoded_text,
            normalized_text=normalized_text,
            raw_bytes_size=len(content),
        )

    if source_url and source_url.strip():
        fetched = await fetch_url_content(source_url.strip())
        metadata = InputMetadata(
            source_type="url",
            url=source_url.strip(),
            content_length=len(fetched.get("text", "")),
            parse_status="normalized" if fetched.get("ok") else "fetch_error",
            content_type=fetched.get("content_type"),
            notes=notes + fetched.get("notes", []),
        )
        if not fetched.get("ok"):
            metadata.notes.append(fetched["error"])
            return NormalizedInput(input_source=metadata)

        normalized_text = fetched["text"].strip()
        if not json_like_text(normalized_text):
            metadata.notes.append("Fetched content does not start with JSON markers.")
        return NormalizedInput(
            input_source=metadata,
            original_text=fetched["text"],
            normalized_text=normalized_text,
            raw_bytes_size=len(fetched["text"].encode("utf-8")),
        )

    metadata = InputMetadata(
        source_type="empty",
        content_length=0,
        parse_status="empty",
        notes=["No input was provided."],
    )
    return NormalizedInput(input_source=metadata)
