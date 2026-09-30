"""Google Street View access through the `streetlevel` library.

`streetlevel` talks to the unofficial endpoints used by Google's own viewer
(GeoPhotoService / photometa lookups and streetviewpixels tiles). This is not
the Google Maps Platform API and conflicts with Google's terms; see README.

`upstream_override` rewrites those hosts to a local stub (tests and demos).
"""

from __future__ import annotations

import math
from typing import Optional
from urllib.parse import urlsplit

import aiohttp
import numpy as np
import requests
from PIL import Image

from streetlevel import streetview
from streetlevel.streetview import streetview as sv_impl
from streetlevel.util import get_equirectangular_panorama_async, get_image_async

from .core import PanoInfo

UPSTREAM_HOSTS = (
    "maps.googleapis.com",
    "www.google.com",
    "streetviewpixels-pa.googleapis.com",
    "lh3.ggpht.com",
)
TILE_HEADERS = {
    "Origin": "https://www.google.com",
    "Referer": "https://www.google.com/",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0",
}


def rewrite_url(url: str, override: Optional[str]) -> str:
    if not override:
        return url
    parts = urlsplit(url)
    if parts.hostname not in UPSTREAM_HOSTS:
        return url
    rest = parts.path + (f"?{parts.query}" if parts.query else "")
    return f"{override.rstrip('/')}/{parts.hostname}{rest}"


class _RewritingSession(requests.Session):
    def __init__(self, override: Optional[str]):
        super().__init__()
        self._override = override

    def request(self, method, url, *args, **kwargs):  # noqa: D401 - requests API
        return super().request(method, rewrite_url(url, self._override), *args, **kwargs)


def _pano_info(pano) -> PanoInfo:
    date = pano.date
    return PanoInfo(
        id=pano.id,
        lat=float(pano.lat),
        lng=float(pano.lon),
        heading=math.degrees(pano.heading or 0.0) % 360.0,
        date="" if date is None else str(date),
        is_third_party=bool(pano.is_third_party),
        copyright=str(getattr(pano, "copyright_message", "") or ""),
        uploader=str(getattr(pano, "uploader", "") or ""),
        source=str(getattr(pano, "source", "") or ""),
        links=[math.degrees(l.direction) % 360.0 for l in (pano.links or []) if l.direction is not None],
        raw=pano,
    )


class GoogleStreetViewBackend:
    def __init__(self, upstream_override: Optional[str] = None, locale: str = "en"):
        self.override = upstream_override
        self.locale = locale
        self.session = _RewritingSession(upstream_override)

    def lookup(self, point: dict, radius: int = 50, search_third_party: bool = False) -> Optional[PanoInfo]:
        """Pano id first (from a pasted URL), then nearest pano to lat/lng. Blocking."""
        pano = None
        if point.get("pano_id"):
            pano = streetview.find_panorama_by_id(point["pano_id"], locale=self.locale, session=self.session)
        if pano is None:
            pano = streetview.find_panorama(point["lat"], point["lng"], radius=radius, locale=self.locale,
                                            search_third_party=search_third_party, session=self.session)
        if pano is not None and (not pano.image_sizes or not pano.links):
            full = streetview.find_panorama_by_id(pano.id, locale=self.locale, session=self.session)
            pano = full or pano
        return _pano_info(pano) if pano is not None else None

    async def fetch_equirect(self, info: PanoInfo, zoom: int) -> np.ndarray:
        pano = info.raw
        if not pano.image_sizes:
            raise ValueError("panorama has no image sizes")
        zoom = max(0, min(zoom, len(pano.image_sizes) - 1))
        async with aiohttp.ClientSession() as session:
            if pano.is_third_party:
                url = rewrite_url(sv_impl._build_sized_third_party_image_url(pano, zoom), self.override)
                image = await get_image_async(url, session)
            else:
                tiles = sv_impl._generate_tile_list(pano, zoom)
                for tile in tiles:
                    tile.url = rewrite_url(tile.url, self.override)
                size = pano.image_sizes[zoom]
                image = await get_equirectangular_panorama_async(size.x, size.y, pano.tile_size, tiles,
                                                                 session, headers=TILE_HEADERS)
        return np.asarray(image.convert("RGB"))


def encode_jpeg(array: np.ndarray, quality: int = 86) -> bytes:
    import io
    buf = io.BytesIO()
    Image.fromarray(array).save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()
