from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates


router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/")
async def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html", context={})


@router.get("/tutorial")
async def tutorial(request: Request):
    return templates.TemplateResponse(request=request, name="tutorial.html", context={})
