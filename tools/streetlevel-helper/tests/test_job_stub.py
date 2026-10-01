"""End-to-end job: real streetlevel parsing + tile stitching against the local stub, real upload client against the fake Platform."""

import asyncio
import io

import pytest
from PIL import Image

from sp_streetlevel.core import parse_csv
from sp_streetlevel.google import GoogleStreetViewBackend, rewrite_url
from sp_streetlevel.job import Job, run_job
from sp_streetlevel.platform import AuthError, PlatformClient, validate_api_base

from .conftest import PANO_ID, point


async def nosleep(_s):
    return None


def make(platform_api, upstream, points, token="good-token", **options):
    job = Job(points=points, options={"zoom": 1, "width": 320, "min_interval": 0, **options},
              media_prefix="user1/proj1/", public_base=f"{platform_api.base}/public", project_id="proj1")
    client = PlatformClient(platform_api.base, lambda: token)
    backend = GoogleStreetViewBackend(upstream_override=upstream.base)
    return job, backend, client


def test_rewrite_only_touches_google_hosts():
    assert rewrite_url("https://streetviewpixels-pa.googleapis.com/v1/tile?x=1", "http://s") == \
        "http://s/streetviewpixels-pa.googleapis.com/v1/tile?x=1"
    assert rewrite_url("https://example.com/a", "http://s") == "https://example.com/a"
    assert rewrite_url("https://www.google.com/maps", None) == "https://www.google.com/maps"


def test_api_base_validation():
    assert validate_api_base("https://sp-survey.org/admin") == "https://sp-survey.org"
    assert validate_api_base("http://localhost:3001") == "http://localhost:3001"
    with pytest.raises(ValueError):
        validate_api_base("http://evil.example")


async def test_full_job_uploads_views_and_metadata(platform_api, upstream):
    points = [
        point("a", heading=90, pitch=5, fov=60, label="A"),
        point("b", panoId=PANO_ID, sourceUrl="https://www.google.com/maps/@1.29,103.77,3a"),
        point("far", lat=10.5, lng=10.5),
    ]
    job, backend, client = make(platform_api, upstream, points, preset="headings", heading_count=2)
    await run_job(job, backend, client, sleep=nosleep)

    assert job.state == "done", job.error
    assert job.counts() == {"total": 3, "done": 2, "noImage": 1, "failed": 0, "pending": 0, "running": 0, "files": 4}
    imgs = sorted(k for k in platform_api.uploads if k.endswith(".jpg"))
    assert imgs == [f"user1/proj1/street-level/gsv-{PANO_ID}-h021-p00-f090.jpg",
                    f"user1/proj1/street-level/gsv-{PANO_ID}-h090-p05-f060.jpg",
                    f"user1/proj1/street-level/gsv-{PANO_ID}-h201-p00-f090.jpg",
                    f"user1/proj1/street-level/gsv-{PANO_ID}-h270-p05-f060.jpg"]
    assert all(host in {"maps.googleapis.com", "www.google.com", "streetviewpixels-pa.googleapis.com"}
               for host, _p, _q in upstream.requests)
    tiles = [q for host, _p, q in upstream.requests if host.startswith("streetviewpixels")]
    assert len(tiles) == 2 and {q["zoom"] for q in tiles} == {"1"}  # shared pano fetched once
    view = Image.open(io.BytesIO(platform_api.objects[imgs[1]][0]))
    assert {r["view_source"] for r in parse_csv(platform_api.objects["user1/proj1/features/street_level_v1.csv"][0].decode())} == {"point", "batch"}
    assert view.size == (320, 240)

    csv_key = "user1/proj1/features/street_level_v1.csv"
    rows = parse_csv(platform_api.objects[csv_key][0].decode("utf-8"))
    assert {r["media_id"] for r in rows} == set(imgs)
    row = rows[0]
    assert row["provider"] == "google_streetview" and row["pano_id"] == PANO_ID
    assert row["captured_at"] == "2019-06" and "unofficial" in row["acquisition"]
    assert row["copyright"].startswith("©")
    assert job.entries[0]["url"].startswith(f"{platform_api.base}/public/")
    assert job.snapshot()["tags"] == {"street-level": "category"}


async def test_pano_preset_stores_stitched_equirect(platform_api, upstream):
    job, backend, client = make(platform_api, upstream, [point("a")], preset="pano")
    await run_job(job, backend, client, sleep=nosleep)
    key = f"user1/proj1/street-level/gsv-{PANO_ID}-pano.jpg"
    img = Image.open(io.BytesIO(platform_api.objects[key][0])).convert("RGB")
    assert img.size == (1024, 512)
    assert img.getpixel((10, 200))[0] < img.getpixel((1000, 200))[0]


async def test_resume_skips_existing_files_and_retries_tiles(platform_api, upstream):
    upstream.fail_tiles = 1
    job, backend, client = make(platform_api, upstream, [point("a", heading=0)])
    await run_job(job, backend, client, sleep=nosleep)
    assert job.state == "done"
    first_tiles = sum(1 for h, _p, _q in upstream.requests if h.startswith("streetviewpixels"))
    assert first_tiles == 3  # 2 tiles + one 503 retried by streetlevel
    uploads_before = len(platform_api.uploads)

    again, backend2, client2 = make(platform_api, upstream, [point("a", heading=0)])
    await run_job(again, backend2, client2, sleep=nosleep)
    assert again.state == "done" and again.items["a"]["keys"] == job.items["a"]["keys"]
    assert sum(1 for h, _p, _q in upstream.requests if h.startswith("streetviewpixels")) == first_tiles
    assert [k for k in platform_api.uploads[uploads_before:] if k.endswith(".jpg")] == []


async def test_bad_token_pauses_as_needs_auth(platform_api, upstream):
    job, backend, client = make(platform_api, upstream, [point("a")], token="wrong")
    await run_job(job, backend, client, sleep=nosleep)
    assert job.state == "needs-auth"
    assert platform_api.uploads == []
    with pytest.raises(AuthError):
        await asyncio.to_thread(client.list_keys, "user1/")


async def test_rate_limit_spaces_upstream_calls(platform_api, upstream):
    waits = []

    async def record(s):
        waits.append(s)

    clock = iter(range(0, 10_000)).__next__
    job, backend, client = make(platform_api, upstream, [point("a"), point("b", lat=1.2975)], min_interval=2)
    await run_job(job, backend, client, sleep=record, clock=lambda: float(clock()) * 0.001)
    assert waits and all(w > 0 for w in waits)
