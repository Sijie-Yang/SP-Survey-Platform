import asyncio

from aiohttp.test_utils import TestClient, TestServer

from sp_streetlevel.backends import make_backend
from sp_streetlevel.server import HelperState, make_app

from .conftest import point

ORIGIN = "http://localhost:3000"


async def client_for(upstream, origins=(ORIGIN,)):
    state = HelperState(lambda opts: make_backend(opts, upstream_override=upstream.base), allowed_origins=origins)
    client = TestClient(TestServer(make_app(state)))
    await client.start_server()
    return client, state


async def wait_state(client, job_id, states, timeout=20):
    for _ in range(int(timeout / 0.05)):
        res = await client.get(f"/jobs/{job_id}", headers={"Origin": ORIGIN})
        body = await res.json()
        if body["state"] in states:
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"job stuck in {body['state']}")


def job_body(platform_api, token="good-token", **options):
    return {
        "apiBase": platform_api.base, "projectId": "proj1", "mediaPrefix": "user1/proj1/",
        "publicBase": f"{platform_api.base}/public", "token": token,
        "points": [point("a", heading=45), point("far", lat=10.5, lng=10.5)],
        "options": {"zoom": 1, "width": 320, "minInterval": 0, **options},
    }


async def test_cors_private_network_preflight_and_origin_guard(upstream):
    client, _ = await client_for(upstream)
    try:
        pre = await client.options("/jobs", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST",
                                                      "Access-Control-Request-Private-Network": "true"})
        assert pre.status == 204
        assert pre.headers["Access-Control-Allow-Origin"] == ORIGIN
        assert pre.headers["Access-Control-Allow-Private-Network"] == "true"
        bad = await client.options("/jobs", headers={"Origin": "https://evil.example"})
        assert bad.status == 403
        assert (await client.post("/jobs", json={}, headers={"Origin": "https://evil.example"})).status == 403
        assert (await client.post("/jobs", json={})).status == 403
        health = await client.get("/health", headers={"Origin": ORIGIN})
        assert (await health.json())["helper"] == "sp-streetlevel"
    finally:
        await client.close()


async def test_rejects_unsafe_api_base_and_prefix(upstream, platform_api):
    client, _ = await client_for(upstream)
    try:
        body = job_body(platform_api)
        res = await client.post("/jobs", json={**body, "apiBase": "http://evil.example"}, headers={"Origin": ORIGIN})
        assert res.status == 400
        res = await client.post("/jobs", json={**body, "mediaPrefix": "templates/x/"}, headers={"Origin": ORIGIN})
        assert res.status == 400
        res = await client.post("/jobs", json={**body, "options": {"source": "mapillary"}}, headers={"Origin": ORIGIN})
        assert res.status == 400 and "free access token" in (await res.json())["error"]
    finally:
        await client.close()


async def test_job_runs_reports_entries_and_resumes_after_token_refresh(upstream, platform_api):
    client, _ = await client_for(upstream)
    try:
        res = await client.post("/jobs", json=job_body(platform_api, token="expired"), headers={"Origin": ORIGIN})
        job_id = (await res.json())["jobId"]
        paused = await wait_state(client, job_id, {"needs-auth"})
        assert paused["counts"]["done"] == 0 and platform_api.uploads == []

        await client.post(f"/jobs/{job_id}/token", json={"token": "good-token"}, headers={"Origin": ORIGIN})
        done = await wait_state(client, job_id, {"done", "partial"})
        assert done["state"] == "done"
        assert done["counts"]["done"] == 1 and done["counts"]["noImage"] == 1
        assert done["items"]["a"]["status"] == "done"
        assert [e["name"] for e in done["entries"]] == ["gsv-F7ng4IZidNWzfUWGIVSwyw-h045-p00-f090.jpg"]
        assert done["tags"] == {"street-level": "category"}
        tail = await (await client.get(f"/jobs/{job_id}?since=1", headers={"Origin": ORIGIN})).json()
        assert tail["entries"] == [] and tail["entryCount"] == 1
        assert "user1/proj1/features/street_level_v1.csv" in platform_api.objects
    finally:
        await client.close()


async def test_jobs_queue_fifo_and_cancel(upstream, platform_api):
    client, state = await client_for(upstream)
    try:
        first = (await (await client.post("/jobs", json=job_body(platform_api), headers={"Origin": ORIGIN})).json())["jobId"]
        second = (await (await client.post("/jobs", json=job_body(platform_api), headers={"Origin": ORIGIN})).json())["jobId"]
        await client.post(f"/jobs/{second}/cancel", headers={"Origin": ORIGIN})
        assert (await wait_state(client, first, {"done", "partial"}))["state"] == "done"
        assert (await wait_state(client, second, {"cancelled"}))["state"] == "cancelled"
    finally:
        await client.close()
