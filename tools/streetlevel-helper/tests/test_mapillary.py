import io

import pytest
from PIL import Image

from sp_streetlevel.backends import make_backend
from sp_streetlevel.core import parse_csv
from sp_streetlevel.job import Job, run_job
from sp_streetlevel.mapillary import ProviderAuthError
from sp_streetlevel.platform import PlatformClient

from .conftest import point


async def nosleep(_s):
    return None


def make(platform_api, mapillary, points, token="MLY|good", **options):
    job = Job(points=points, options={"source": "mapillary", "mapillaryToken": token, "width": 320, "minInterval": 0, **options},
              media_prefix="user1/proj1/", public_base=f"{platform_api.base}/public", project_id="proj1")
    return job, PlatformClient(platform_api.base, lambda: "good-token")


def test_empty_token_is_reported_not_silent():
    with pytest.raises(ProviderAuthError, match="free access token"):
        make_backend({"source": "mapillary", "mapillary_token": ""})


async def test_mapillary_pano_and_photo_with_attribution(platform_api, mapillary):
    pts = [point("pano", lat=1.2970, heading=90), point("photo", lat=1.2980), point("none", lat=10.5, lng=10.5)]
    job, client = make(platform_api, mapillary, pts)
    backend = make_backend(job.options, mapillary_api=mapillary.base)
    await run_job(job, backend, client, sleep=nosleep)
    assert job.state == "done", job.error
    assert job.counts()["noImage"] == 1
    imgs = sorted(k for k in platform_api.uploads if k.endswith(".jpg"))
    assert imgs == ["user1/proj1/street-level/mly-9001-h090-p00-f090.jpg", "user1/proj1/street-level/mly-9002-orig.jpg"]
    assert Image.open(io.BytesIO(platform_api.objects[imgs[0]][0])).size == (320, 240)
    assert Image.open(io.BytesIO(platform_api.objects[imgs[1]][0])).size == (1024, 768)
    assert all(q.get("access_token") == "MLY|good" for q in mapillary.requests)
    assert all(int(q["radius"]) <= 50 for q in mapillary.requests)
    rows = {r["media_id"]: r for r in parse_csv(platform_api.objects["user1/proj1/features/street_level_v1.csv"][0].decode())}
    row = rows[imgs[0]]
    assert row["provider"] == "mapillary" and row["license"] == "CC BY-SA 4.0"
    assert row["uploader"] == "mapper_a" and row["attribution_url"].endswith("pKey=9001")
    assert "Mapillary Graph API" in row["acquisition"] and row["captured_at"] == "2024-05-06"
    entry = next(e for e in job.entries if e["key"] == imgs[0])
    assert entry["attribution"]["license"] == "CC BY-SA 4.0" and entry["streetLevel"]["provider"] == "mapillary"
    assert "mapillary_token" not in job.snapshot()["options"]


async def test_rejected_token_stops_job_with_message(platform_api, mapillary):
    job, client = make(platform_api, mapillary, [point("a"), point("b", lat=1.29)], token="MLY|bad")
    backend = make_backend(job.options, mapillary_api=mapillary.base)
    await run_job(job, backend, client, sleep=nosleep)
    assert job.state == "failed"
    assert "rejected the access token" in job.error
    assert len(mapillary.requests) == 1
    assert [k for k in platform_api.uploads if k.endswith(".jpg")] == []
