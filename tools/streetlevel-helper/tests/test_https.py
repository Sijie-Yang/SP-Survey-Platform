"""HTTPS /health against the per-user certificate. Does not trust anything in the OS store."""

import aiohttp
import pytest
from aiohttp import web

from sp_streetlevel.certs import client_ssl_context, ensure_certs, server_ssl_context
from sp_streetlevel.server import DEFAULT_ORIGINS, HelperState, make_app


def _port(site: web.TCPSite) -> int:
    return site._server.sockets[0].getsockname()[1]


async def test_https_health_response_against_the_local_cert(tmp_path):
    assert "https://www.sp-survey.org" in DEFAULT_ORIGINS
    assert "https://sp-survey.org" in DEFAULT_ORIGINS
    paths = ensure_certs(tmp_path)
    state = HelperState(lambda _opts: None, allowed_origins=DEFAULT_ORIGINS)
    runner = web.AppRunner(make_app(state))
    await runner.setup()
    https = web.TCPSite(runner, "127.0.0.1", 0, ssl_context=server_ssl_context(paths))
    http = web.TCPSite(runner, "127.0.0.1", 0)
    await https.start()
    await http.start()
    url = f"https://127.0.0.1:{_port(https)}/health"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, ssl=client_ssl_context(paths), headers={"Origin": "https://www.sp-survey.org"}) as resp:
                body = await resp.json()
                assert resp.status == 200
                assert body["ok"] is True
                assert body["helper"] == "sp-streetlevel"
                assert body["version"]
                assert resp.headers["Access-Control-Allow-Origin"] == "https://www.sp-survey.org"
                assert resp.headers["Access-Control-Allow-Private-Network"] == "true"
            async with session.options(url, ssl=client_ssl_context(paths), headers={
                "Origin": "https://sp-survey.org",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Private-Network": "true",
            }) as resp:
                assert resp.status == 204
                assert resp.headers["Access-Control-Allow-Origin"] == "https://sp-survey.org"
                assert resp.headers["Access-Control-Allow-Private-Network"] == "true"
            with pytest.raises(aiohttp.ClientConnectorCertificateError):
                async with session.get(url) as resp:
                    await resp.read()
            async with session.get(
                f"http://127.0.0.1:{_port(http)}/health", headers={"Origin": "https://sp-survey.org"},
            ) as resp:
                assert (await resp.json())["helper"] == "sp-streetlevel"
                assert resp.headers["Access-Control-Allow-Private-Network"] == "true"
            async with session.get(url, ssl=client_ssl_context(paths), headers={"Origin": "https://evil.example"}) as resp:
                assert resp.status == 403
    finally:
        await runner.cleanup()
