"""Mapillary (CC BY-SA 4.0) through the official Graph API v4.

Mapillary always needs a free client access token (mapillary.com/dashboard/developers);
`streetlevel` has no Mapillary module, so this is a small direct client.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Optional

import aiohttp
import numpy as np
import requests
from PIL import Image

from .core import PanoInfo, angle_diff, distance_m
from .net import ssl_context

GRAPH_API = "https://graph.mapillary.com"
FIELDS = ",".join([
    "id", "geometry", "computed_geometry", "compass_angle", "computed_compass_angle", "captured_at",
    "is_pano", "camera_type", "creator", "sequence", "quality_score", "thumb_2048_url", "thumb_original_url",
])
LICENSE = "CC BY-SA 4.0"


class ProviderAuthError(Exception):
    """The provider rejected or is missing credentials; the whole job stops."""


def _location(image: dict):
    coords = (image.get("computed_geometry") or image.get("geometry") or {}).get("coordinates")
    if not coords or len(coords) < 2:
        return None
    return float(coords[1]), float(coords[0])


def _is_pano(image: dict) -> bool:
    return bool(image.get("is_pano")) or str(image.get("camera_type") or "").lower() in ("equirectangular", "spherical")


def choose_image(images, point: dict, radius: float, prefer_heading: Optional[float]):
    best = None
    for image in images:
        loc = _location(image)
        if not loc or not image.get("id"):
            continue
        dist = distance_m(point["lat"], point["lng"], *loc)
        if dist > radius + 1:
            continue
        pano = _is_pano(image)
        score = dist - (8 if pano else 0) - 5 * float(image.get("quality_score") or 0)
        if prefer_heading is not None and not pano:
            compass = image.get("computed_compass_angle", image.get("compass_angle"))
            score += 30 if compass is None else angle_diff(float(compass), prefer_heading) * 0.5
        if best is None or score < best[0]:
            best = (score, image, loc)
    return best


class MapillaryBackend:
    def __init__(self, token: str, api_base: str = GRAPH_API, session: Optional[requests.Session] = None):
        if not token:
            raise ProviderAuthError("Mapillary needs a free access token (mapillary.com/dashboard/developers).")
        self.token = token
        self.api_base = api_base.rstrip("/")
        self.session = session or requests.Session()

    def lookup(self, point: dict, radius: int = 50, search_third_party: bool = False,
               prefer_heading: Optional[float] = None) -> Optional[PanoInfo]:
        res = self.session.get(f"{self.api_base}/images", params={
            "access_token": self.token, "fields": FIELDS, "lat": point["lat"], "lng": point["lng"],
            "radius": int(min(50, max(1, radius))), "limit": 30,
        }, timeout=30)
        if res.status_code in (401, 403):
            raise ProviderAuthError("Mapillary rejected the access token.")
        res.raise_for_status()
        picked = choose_image(res.json().get("data") or [], point, min(50, radius),
                              point.get("heading") if point.get("heading") is not None else prefer_heading)
        if not picked:
            return None
        _score, image, (lat, lng) = picked
        user = (image.get("creator") or {}).get("username") or ""
        captured = image.get("captured_at")
        date = datetime.fromtimestamp(captured / 1000, tz=timezone.utc).strftime("%Y-%m-%d") if captured else ""
        compass = image.get("computed_compass_angle", image.get("compass_angle")) or 0.0
        return PanoInfo(
            id=str(image["id"]), lat=lat, lng=lng, heading=float(compass) % 360.0, date=date,
            copyright=f"© {user or 'Mapillary contributor'}, {LICENSE}", uploader=user, source="mapillary",
            raw=image, provider="mapillary", is_pano=_is_pano(image), license=LICENSE,
            link=f"https://www.mapillary.com/app/?pKey={image['id']}",
        )

    async def fetch_equirect(self, info: PanoInfo, zoom: int) -> np.ndarray:
        image = info.raw or {}
        url = (image.get("thumb_original_url") if zoom >= 3 else None) or image.get("thumb_2048_url") \
            or image.get("thumb_original_url")
        if not url:
            raise ValueError("Mapillary image has no downloadable rendition")
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ssl_context())) as session:
            async with session.get(url) as res:
                res.raise_for_status()
                data = await res.read()
        return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
