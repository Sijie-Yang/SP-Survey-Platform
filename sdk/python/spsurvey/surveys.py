"""Deterministic survey builders for the common perception paradigms.

Each builder returns a ``surveyConfig`` dict the platform accepts as is. Media
come from the project's own media library (upload files first, see
``Client.upload_images``); the platform draws images per participant, so the
config does not list image URLs."""
from __future__ import annotations

import re
from typing import Iterable, List, Optional

# Random draw from the project media library, as the platform's design protocol defines it.
MEDIA_SAMPLING = {
    "imageSelectionMode": "huggingface_random",
    "randomImageSelection": True,
    "excludePreviouslyUsedImages": True,
    "choices": [],
}


def slug(text: str, fallback: str = "q") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", str(text or "").lower()).strip("_")
    return s[:40] or fallback


def pairwise_question(name: str, title: str, trials: int = 12, allow_tie: bool = False, folders: Optional[List[str]] = None) -> dict:
    """Two images per trial, participant picks one. Analysed with TrueSkill."""
    q = {"type": "imagepicker", "name": name, "title": title, "imageCount": 2, "trialCount": int(trials), **MEDIA_SAMPLING}
    if allow_tie:
        q["allowTie"] = True
    if folders:
        q["mediaFolders"] = list(folders)
    return q


def rating_question(name: str, title: str, trials: int = 10, scale_min: int = 1, scale_max: int = 7, folders: Optional[List[str]] = None) -> dict:
    """One image per trial on a numeric scale. Analysed as per-image means."""
    q = {"type": "imagerating", "name": name, "title": title, "imageCount": 1, "trialCount": int(trials),
         "rateMin": int(scale_min), "rateMax": int(scale_max), **MEDIA_SAMPLING}
    if folders:
        q["mediaFolders"] = list(folders)
    return q


def slider_group_question(name: str, title: str, dimensions: Iterable[dict], trials: int = 10, scale_min: int = 0, scale_max: int = 100) -> dict:
    """One image, several sliders (``{"id","label","left","right"}`` each)."""
    dims = []
    for d in dimensions:
        dims.append({"id": d.get("id") or slug(d.get("label", "")), "label": d.get("label", ""), "left": d.get("left", ""), "right": d.get("right", "")})
    return {"type": "imageslidergroup", "name": name, "title": title, "imageCount": 1, "trialCount": int(trials),
            "scaleMin": int(scale_min), "scaleMax": int(scale_max), "dimensions": dims, **MEDIA_SAMPLING}


def consent_question(text: str = "I have read the information above and agree to take part.", name: str = "consent") -> dict:
    return {"type": "boolean", "name": name, "title": text, "isRequired": True}


def demographics_page(age: bool = True, gender: bool = True) -> dict:
    elements = []
    if age:
        elements.append({"type": "dropdown", "name": "age", "title": "Your age group", "choices": ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]})
    if gender:
        elements.append({"type": "radiogroup", "name": "gender", "title": "Your gender", "choices": ["Female", "Male", "Non-binary", "Prefer not to say"]})
    return {"name": "about_you", "elements": elements}


def survey(title: str, questions: List[dict], intro_html: str = "", consent: bool = True, demographics: bool = False, locale: str = "en") -> dict:
    """Assemble pages: optional intro + consent, one page per question, optional demographics."""
    pages = []
    first = []
    if intro_html:
        first.append({"type": "html", "name": "intro", "html": intro_html})
    if consent:
        first.append(consent_question())
    if first:
        pages.append({"name": "welcome", "elements": first})
    names = set()
    for i, q in enumerate(questions):
        if q["name"] in names:
            raise ValueError(f"Duplicate question name: {q['name']}")
        names.add(q["name"])
        pages.append({"name": f"page_{i + 1}", "elements": [q]})
    if demographics:
        pages.append(demographics_page())
    return {"title": title, "locale": locale if locale in ("en", "zh") else "en", "pages": pages}


def pairwise_survey(title: str, question: str, trials: int = 12, allow_tie: bool = False, **kwargs) -> dict:
    """Shortcut: one pairwise-comparison question (e.g. "Which street looks safer?")."""
    return survey(title, [pairwise_question(slug(question, "preference"), question, trials=trials, allow_tie=allow_tie)], **kwargs)


def rating_survey(title: str, question: str, trials: int = 10, scale_min: int = 1, scale_max: int = 7, **kwargs) -> dict:
    """Shortcut: one per-image rating question."""
    return survey(title, [rating_question(slug(question, "rating"), question, trials=trials, scale_min=scale_min, scale_max=scale_max)], **kwargs)
