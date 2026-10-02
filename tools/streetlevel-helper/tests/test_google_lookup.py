"""Pano-id downloads, wider search, and the streetlevel 0.12 equirectangular signature."""

import inspect

import pytest
from PIL import Image

from sp_streetlevel.core import PanoInfo
from sp_streetlevel.google import (
    NO_PANO, TILE_HEADERS, WIDE_LOOKUP_RADIUS_M, GoogleStreetViewBackend, accepted_kwargs,
    pano_id_from_google_url,
)
from sp_streetlevel.job import Job, run_job
from sp_streetlevel.platform import PlatformClient

from .conftest import point

SV = ("https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,90.5h,95.3t/data=!3m6!1e1"
      "!3m4!1sAbCdEfGhIjKlMnOpQrStUv!2e0")


class _Link:
    direction = 0.0


class _Pano:
    def __init__(self, pano_id="KNOWN"):
        self.id = pano_id
        self.lat = 1.0
        self.lon = 2.0
        self.heading = 0.0
        self.date = None
        self.is_third_party = False
        self.copyright_message = ""
        self.uploader = ""
        self.source = ""
        self.links = [_Link()]
        self.image_sizes = [object()]


def _bind(monkeypatch):
    calls = {"by_id": [], "search": []}

    def by_id(pano_id, **kwargs):
        calls["by_id"].append(pano_id)
        if pano_id == "MISSING":
            return None
        return _Pano(pano_id)

    def search(lat, lon, radius=50, **kwargs):
        calls["search"].append(radius)
        if radius < WIDE_LOOKUP_RADIUS_M:
            return None
        return _Pano("WIDE")

    monkeypatch.setattr("sp_streetlevel.google.streetview.find_panorama_by_id", by_id)
    monkeypatch.setattr("sp_streetlevel.google.streetview.find_panorama", search)
    return calls


def test_pano_id_from_a_stored_google_url():
    assert pano_id_from_google_url(SV) == "AbCdEfGhIjKlMnOpQrStUv"
    api = ("https://www.google.com/maps/@?api=1&map_action=pano&pano=tu510ie_z4ptBZYo2BGEJg"
           "&viewpoint=48.857832%2C2.295226")
    assert pano_id_from_google_url(api) == "tu510ie_z4ptBZYo2BGEJg"
    place = ("https://www.google.com/maps/place/Eiffel/@48.8,2.29,17z/data=!3m1!4b1"
             "!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0")
    assert pano_id_from_google_url(place) is None
    assert pano_id_from_google_url("https://example.com/maps/@1,2,3a") is None


def test_known_pano_is_downloaded_directly(monkeypatch):
    calls = _bind(monkeypatch)
    backend = GoogleStreetViewBackend()
    pano, reason = backend.lookup({"lat": 1, "lng": 2, "pano_id": "KNOWN"}, radius=50)
    assert reason is None and pano.id == "KNOWN"
    assert calls["search"] == []

    missed, why = backend.lookup({"lat": 1, "lng": 2, "pano_id": "MISSING"}, radius=50)
    assert missed is None and why == NO_PANO
    assert calls["search"] == []

    from_url, why = backend.lookup({"lat": 1, "lng": 2, "source_url": SV}, radius=50)
    assert why is None and from_url.id == "AbCdEfGhIjKlMnOpQrStUv"
    assert calls["by_id"][-1] == "AbCdEfGhIjKlMnOpQrStUv"
    assert calls["search"] == []


def test_search_widens_before_no_coverage(monkeypatch):
    calls = _bind(monkeypatch)
    backend = GoogleStreetViewBackend()
    pano, reason = backend.lookup({"lat": 1.2, "lng": 103.8}, radius=50)
    assert reason is None and pano.id == "WIDE"
    assert calls["search"] == [50, WIDE_LOOKUP_RADIUS_M]
    assert calls["by_id"] == []


def test_search_exception_is_not_swallowed(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("photometa HTTP 500")

    monkeypatch.setattr("sp_streetlevel.google.streetview.find_panorama", boom)
    with pytest.raises(RuntimeError, match="photometa HTTP 500"):
        GoogleStreetViewBackend().lookup({"lat": 1, "lng": 2}, radius=50)


def test_accepted_kwargs_match_the_012_signature():
    async def streetlevel_012(width, height, tile_size, tile_list, session):
        return None

    assert accepted_kwargs(streetlevel_012, {"headers": TILE_HEADERS}) == {}
    inspect.signature(streetlevel_012).bind(8, 4, None, [], None, **accepted_kwargs(
        streetlevel_012, {"headers": TILE_HEADERS}))

    async def streetlevel_012_with_headers(width, height, tile_size, tile_list, session, headers=None):
        return headers

    assert accepted_kwargs(streetlevel_012_with_headers, {"headers": TILE_HEADERS}) == {"headers": TILE_HEADERS}

    try:
        from streetlevel.util import get_equirectangular_panorama_async as installed
    except ImportError:
        installed = None
    if installed is not None:
        extra = accepted_kwargs(installed, {"headers": TILE_HEADERS})
        inspect.signature(installed).bind(8, 4, None, [], None, **extra)
        unknown = set(extra) - set(inspect.signature(installed).parameters)
        assert not unknown


async def test_fetch_equirect_does_not_pass_unknown_kwargs(monkeypatch):
    """A stub with the real 0.12.5 signature fails the test if we pass headers=."""
    from streetlevel.dataclasses import Size

    async def streetlevel_012(width, height, tile_size, tile_list, session):
        return Image.new("RGB", (width, height), (9, 8, 7))

    monkeypatch.setattr("sp_streetlevel.google.get_equirectangular_panorama_async", streetlevel_012)
    monkeypatch.setattr("sp_streetlevel.google.sv_impl._generate_tile_list", lambda pano, zoom: [])

    class Raw:
        is_third_party = False
        image_sizes = [Size(16, 8)]
        tile_size = Size(16, 8)

    image = await GoogleStreetViewBackend().fetch_equirect(PanoInfo(id="x", lat=0, lng=0, raw=Raw()), 0)
    assert image.shape == (8, 16, 3)
    assert tuple(image[0, 0]) == (9, 8, 7)


async def nosleep(_s):
    return None


class _LookupBoom:
    def lookup(self, *args, **kwargs):
        raise RuntimeError("photometa HTTP 500")

    async def fetch_equirect(self, *args, **kwargs):
        raise AssertionError("tiles should not be fetched")


class _TilesBoom:
    def lookup(self, *args, **kwargs):
        return PanoInfo(id="P", lat=1, lng=2, heading=0, links=[0])

    async def fetch_equirect(self, *args, **kwargs):
        raise RuntimeError("HTTP 404")


async def test_exceptions_stay_failed_not_no_coverage(platform_api):
    client = PlatformClient(platform_api.base, lambda: "good-token")
    lookup_job = Job(points=[point("a")], options={"min_interval": 0, "max_attempts": 1},
                     media_prefix="user1/proj1/", public_base=f"{platform_api.base}/public")
    await run_job(lookup_job, _LookupBoom(), client, sleep=nosleep)
    assert lookup_job.items["a"]["status"] == "failed"
    assert "photometa HTTP 500" in lookup_job.items["a"]["error"]
    assert lookup_job.items["a"]["status"] != "no-image"

    tile_job = Job(points=[point("b")], options={"min_interval": 0, "max_attempts": 1},
                   media_prefix="user1/proj1/", public_base=f"{platform_api.base}/public")
    await run_job(tile_job, _TilesBoom(), client, sleep=nosleep)
    assert tile_job.items["b"]["status"] == "failed"
    assert tile_job.items["b"]["error"].startswith("tiles failed:")
    assert "HTTP 404" in tile_job.items["b"]["error"]
