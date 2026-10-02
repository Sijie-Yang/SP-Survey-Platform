"""Localhost helper the Platform panel talks to (Download button).

Binds 127.0.0.1 only. HTTP stays on 47821; HTTPS (a per-user CA, leaf for
127.0.0.1 and localhost) listens on 47822 so Safari can call it from
https://sp-survey.org. Browser calls are accepted only from allowlisted Platform
origins (CORS + Private Network Access preflight). Jobs run one at a time in
FIFO order; the upstream rate limit lives in the job runner.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Dict, Iterable, Optional

from aiohttp import web

from . import __version__
from .certs import default_cert_dir, ensure_certs, server_ssl_context, trust_local_ca
from .job import STREETLEVEL_VERSION, Job, run_job
from .platform import PlatformClient, validate_api_base

DEFAULT_PORT = 47821
DEFAULT_HTTPS_PORT = 47822
DEFAULT_ORIGINS = (
    "https://sp-survey.org",
    "https://www.sp-survey.org",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)
MAX_POINTS = 5000


class HelperState:
    def __init__(self, backend_factory, platform_factory=PlatformClient, allowed_origins: Iterable[str] = DEFAULT_ORIGINS):
        self.backend_factory = backend_factory
        self.platform_factory = platform_factory
        self.allowed = {o.rstrip("/") for o in allowed_origins}
        self.jobs: Dict[str, Job] = {}
        self.tokens: Dict[str, Optional[str]] = {}
        self.api_bases: Dict[str, str] = {}
        self.queue: "asyncio.Queue[str]" = asyncio.Queue()
        self.worker: Optional[asyncio.Task] = None

    async def run_queue(self):
        while True:
            job_id = await self.queue.get()
            job = self.jobs.get(job_id)
            if job and not job.cancelled:
                platform = self.platform_factory(self.api_bases[job_id], lambda jid=job_id: self.tokens.get(jid))
                try:
                    await run_job(job, self.backend_factory(job.options), platform)
                except Exception as err:  # noqa: BLE001 - surfaced to the panel
                    job.state, job.error = "failed", str(err)[:300]
            elif job:
                job.state = "cancelled"
            self.queue.task_done()


def _cors_headers(request: web.Request, state: HelperState) -> dict:
    origin = request.headers.get("Origin", "").rstrip("/")
    if origin not in state.allowed:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
    }


def make_app(state: HelperState) -> web.Application:
    @web.middleware
    async def guard(request: web.Request, handler):
        cors = _cors_headers(request, state)
        origin = request.headers.get("Origin")
        if request.method == "OPTIONS":
            return web.Response(status=204 if cors else 403, headers=cors)
        if origin and not cors:
            return web.json_response({"ok": False, "error": "Origin not allowed"}, status=403)
        if request.method == "POST" and not origin and request.path != "/health":
            return web.json_response({"ok": False, "error": "Browser origin required"}, status=403)
        try:
            response = await handler(request)
        except web.HTTPException as exc:
            response = web.json_response({"ok": False, "error": exc.text or exc.reason}, status=exc.status)
        response.headers.update(cors)
        return response

    async def health(_request):
        return web.json_response({
            "ok": True, "helper": "sp-streetlevel", "version": __version__, "streetlevel": STREETLEVEL_VERSION,
            "jobs": [{"jobId": j.id, "state": j.state, "projectId": j.project_id} for j in state.jobs.values()][-10:],
        })

    async def create_job(request: web.Request):
        body = await request.json()
        try:
            api_base = validate_api_base(body.get("apiBase", ""))
        except ValueError as err:
            raise web.HTTPBadRequest(text=str(err))
        points = body.get("points") or []
        if not isinstance(points, list) or not points:
            raise web.HTTPBadRequest(text="points required")
        if len(points) > MAX_POINTS:
            raise web.HTTPBadRequest(text=f"at most {MAX_POINTS} points")
        prefix = str(body.get("mediaPrefix") or "")
        if not prefix or ".." in prefix or prefix.startswith(("/", "templates/")):
            raise web.HTTPBadRequest(text="mediaPrefix required")
        options = body.get("options") or {}
        if options.get("source") == "mapillary" and not str(options.get("mapillaryToken") or options.get("mapillary_token") or "").strip():
            raise web.HTTPBadRequest(text="Mapillary needs a free access token (mapillary.com/dashboard/developers). "
                                          "Google Street View does not need one.")
        job = Job(points=points, options=options, media_prefix=prefix,
                  public_base=str(body.get("publicBase") or ""), project_id=str(body.get("projectId") or ""))
        if not job.points:
            raise web.HTTPBadRequest(text="no valid points")
        state.jobs[job.id] = job
        state.tokens[job.id] = body.get("token") or None
        state.api_bases[job.id] = api_base
        await state.queue.put(job.id)
        return web.json_response({"ok": True, "jobId": job.id, "state": job.state, "queuePosition": state.queue.qsize()})

    def _job(request) -> Job:
        job = state.jobs.get(request.match_info["job_id"])
        if not job:
            raise web.HTTPNotFound(text="job not found")
        return job

    async def get_job(request: web.Request):
        job = _job(request)
        since = int(request.query.get("since", "0") or 0)
        return web.json_response({"ok": True, **job.snapshot(since)})

    async def set_token(request: web.Request):
        job = _job(request)
        body = await request.json()
        state.tokens[job.id] = body.get("token") or None
        if job.state == "needs-auth":
            job.reset_unfinished()
            job.state = "queued"
            await state.queue.put(job.id)
        return web.json_response({"ok": True, "state": job.state})

    async def cancel(request: web.Request):
        job = _job(request)
        job.cancelled = True
        if job.state == "queued":
            job.state = "cancelled"
        return web.json_response({"ok": True, "state": job.state})

    async def resume(request: web.Request):
        job = _job(request)
        if job.state in ("running", "queued"):
            return web.json_response({"ok": True, "state": job.state})
        body = await request.json() if request.can_read_body else {}
        if body.get("token"):
            state.tokens[job.id] = body["token"]
        job.reset_unfinished()
        job.state = "queued"
        await state.queue.put(job.id)
        return web.json_response({"ok": True, "state": job.state})

    async def on_startup(_app):
        state.worker = asyncio.create_task(state.run_queue())

    async def on_cleanup(_app):
        if state.worker:
            state.worker.cancel()

    app = web.Application(middlewares=[guard], client_max_size=8 * 1024 * 1024)
    app.router.add_get("/health", health)
    app.router.add_post("/jobs", create_job)
    app.router.add_get("/jobs/{job_id}", get_job)
    app.router.add_post("/jobs/{job_id}/token", set_token)
    app.router.add_post("/jobs/{job_id}/cancel", cancel)
    app.router.add_post("/jobs/{job_id}/resume", resume)
    async def preflight(_request):
        return web.Response(status=204)

    app.router.add_route("OPTIONS", "/{tail:.*}", preflight)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


def listening_message(port: int, https_port: int, origins: Iterable[str]) -> str:
    return (
        f"sp-streetlevel helper listening on http://127.0.0.1:{port} "
        f"and https://127.0.0.1:{https_port} "
        f"(origins: {', '.join(sorted(origins))})"
    )


def serve(
    backend_factory,
    port: int = DEFAULT_PORT,
    allowed_origins: Iterable[str] = DEFAULT_ORIGINS,
    https_port: int = DEFAULT_HTTPS_PORT,
    cert_dir: Optional[Path] = None,
    trust: bool = True,
):
    if port == https_port:
        raise SystemExit("sp-streetlevel HTTP and HTTPS ports must differ")
    certs = ensure_certs(Path(cert_dir) if cert_dir else default_cert_dir())
    ssl_context = server_ssl_context(certs)
    state = HelperState(backend_factory, allowed_origins=allowed_origins)

    async def _bind(runner: web.AppRunner, host_port: int, context=None):
        site = web.TCPSite(runner, "127.0.0.1", host_port, ssl_context=context)
        try:
            await site.start()
        except OSError as err:
            scheme = "https" if context else "http"
            raise SystemExit(f"sp-streetlevel could not listen on {scheme}://127.0.0.1:{host_port}: {err}") from err

    async def _main():
        runner = web.AppRunner(make_app(state))
        await runner.setup()
        await _bind(runner, port)
        await _bind(runner, https_port, ssl_context)
        print(listening_message(port, https_port, state.allowed), flush=True)
        if trust:
            # The prompt can wait on a GUI password dialog; keep the accept loop running.
            await asyncio.to_thread(trust_local_ca, certs.ca_cert)
        while True:
            await asyncio.sleep(3600)

    try:
        asyncio.run(_main())
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as err:
        raise SystemExit(f"sp-streetlevel helper stopped: {err}") from err
