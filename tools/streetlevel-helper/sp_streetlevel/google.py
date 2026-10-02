"""Google Street View access through the `streetlevel` library.

`streetlevel` talks to the unofficial endpoints used by Google's own viewer
(GeoPhotoService / photometa lookups and streetviewpixels tiles). This is not
the Google Maps Platform API and conflicts with Google's terms; see README.

`upstream_override` rewrites those hosts to a local stub (tests and demos).
"""

from __future__ import annotations

import inspect
import math
import re
from typing import Optional
from urllib.parse import parse_qs, unquote, urlsplit

import aiohttp
import numpy as np
import requests
from PIL import Image

from streetlevel import streetview
from streetlevel.streetview import streetview as sv_impl
from streetlevel.util import get_equirectangular_panorama_async, get_image_async

from .core import PanoInfo
from .net import ssl_context

UPSTREAM_HOSTS = (
    "maps.googleapis.com",
    "www.google.com",
    "streetviewpixels-pa.googleapis.com",
    "cbk0.google.com",
    "lh3.ggpht.com",
)
TILE_HEADERS = {
    "Origin": "https://www.google.com",
    "Referer": "https://www.google.com/",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0",
}
# Second try when a lat/lng search is the only option. streetlevel's own default is 50 m.
WIDE_LOOKUP_RADIUS_M = 1000
_PANO_ID_RE = re.compile(r"!1s([^!]+)")
NO_PANO = "no pano returned"


def accepted_kwargs(fn, candidates: dict) -> dict:
    """Keep only kwargs the installed callable actually accepts.

    streetlevel 0.12.5's get_equirectangular_panorama_async(width, height, tile_size,
    tile_list, session) rejects ``headers``. 0.12.10+ added that parameter. The helper
    stays on streetlevel>=0.12,<0.13 and must not pass unknown names.
    """
    params = inspect.signature(fn).parameters
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return dict(candidates)
    return {key: value for key, value in candidates.items() if key in params}


def pano_id_from_google_url(url: Optional[str]) -> Optional[str]:
    """Pano id from a stored Google Street View URL (api=1 ``pano`` or ``!1s`` in /data=)."""
    text = str(url or "").strip()
    if not text:
        return None
    try:
        parts = urlsplit(text)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if "google." not in host:
        return None
    query_pano = (parse_qs(parts.query).get("pano") or [None])[0]
    if query_pano and str(query_pano).strip():
        return str(query_pano).strip()
    path = unquote(parts.path)
    marker = "/data="
    idx = path.find(marker)
    if idx < 0:
        return None
    data = path[idx + len(marker):].split("/")[0]
    if "!1e1" not in data:
        return None
    for match in _PANO_ID_RE.finditer(data):
        pano_id = match.group(1)
        if pano_id.lower().startswith("0x") or ":" in pano_id:
            continue
        return pano_id
    return None


def direct_pano_id(point: dict) -> Optional[str]:
    explicit = str(point.get("pano_id") or "").strip()
    if explicit:
        return explicit
    return pano_id_from_google_url(point.get("source_url"))


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

    def _by_id(self, pano_id: str):
        return streetview.find_panorama_by_id(pano_id, locale=self.locale, session=self.session)

    def _search(self, point: dict, radius: int, search_third_party: bool):
        return streetview.find_panorama(point["lat"], point["lng"], radius=int(radius), locale=self.locale,
                                        search_third_party=search_third_party, session=self.session)

    def _complete(self, pano):
        if pano is not None and (not pano.image_sizes or not pano.links):
            full = self._by_id(pano.id)
            pano = full or pano
        return _pano_info(pano) if pano is not None else None

    def lookup(self, point: dict, radius: int = 50, search_third_party: bool = False,
               prefer_heading: Optional[float] = None):
        """Download a known panorama directly, otherwise search then a wider radius.

        A pano id, or a pano id inside a stored Google URL, is fetched with
        ``find_panorama_by_id`` and is not replaced by a nearest-point search.
        Search is only used when that is the only option: the requested radius
        first, then ``WIDE_LOOKUP_RADIUS_M`` if nothing came back.

        Returns ``(PanoInfo, None)`` or ``(None, reason)``. Exceptions propagate;
        a miss is not an exception.
        """
        pano_id = direct_pano_id(point)
        if pano_id:
            pano = self._by_id(pano_id)
            if pano is None:
                return None, NO_PANO
            return self._complete(pano), None
        requested = int(radius)
        pano = self._search(point, requested, search_third_party)
        if pano is None and requested < WIDE_LOOKUP_RADIUS_M:
            pano = self._search(point, WIDE_LOOKUP_RADIUS_M, search_third_party)
        if pano is None:
            return None, NO_PANO
        return self._complete(pano), None

    async def fetch_equirect(self, info: PanoInfo, zoom: int) -> np.ndarray:
        pano = info.raw
        if not pano.image_sizes:
            raise ValueError("panorama has no image sizes")
        zoom = max(0, min(zoom, len(pano.image_sizes) - 1))
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ssl_context())) as session:
            if pano.is_third_party:
                url = rewrite_url(sv_impl._build_sized_third_party_image_url(pano, zoom), self.override)
                image = await get_image_async(url, session)
            else:
                tiles = sv_impl._generate_tile_list(pano, zoom)
                for tile in tiles:
                    tile.url = rewrite_url(tile.url, self.override)
                size = pano.image_sizes[zoom]
                # 0.12.5 does not accept headers; 0.12.10+ does. Pass it only when the
                # installed signature lists it.
                image = await get_equirectangular_panorama_async(
                    size.x, size.y, pano.tile_size, tiles, session,
                    **accepted_kwargs(get_equirectangular_panorama_async, {"headers": TILE_HEADERS}),
                )
        return np.asarray(image.convert("RGB"))


def encode_jpeg(array: np.ndarray, quality: int = 86) -> bytes:
    import io
    buf = io.BytesIO()
    Image.fromarray(array).save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()
