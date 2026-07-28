from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates


router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

STATIC_DIR = Path("app/static")


def asset_version() -> str:
    """Newest static-file mtime, so browsers refetch CSS/JS after a deploy."""
    mtimes = [p.stat().st_mtime for p in STATIC_DIR.glob("*") if p.is_file()]
    return str(int(max(mtimes))) if mtimes else "0"


@router.get("/")
async def home(request: Request):
    return templates.TemplateResponse(
        request=request, name="index.html", context={"asset_v": asset_version()}
    )


@router.get("/tutorial")
async def tutorial(request: Request):
    return templates.TemplateResponse(
        request=request, name="tutorial.html", context={"asset_v": asset_version()}
    )
