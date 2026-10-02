"""`sp-streetlevel serve` (helper for the Download button) and `sp-streetlevel run` (one-command fallback)."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

from . import __version__
from .core import folder_tags
from .backends import make_backend
from .job import Job, run_job
from .platform import PlatformClient, validate_api_base
from .server import DEFAULT_HTTPS_PORT, DEFAULT_ORIGINS, DEFAULT_PORT, serve

DEFAULT_API = "https://sp-survey.org"
OPTION_FLAGS = ("source", "preset", "heading_mode", "fixed_heading", "heading_count", "pitch", "fov", "width", "zoom",
                "radius", "folder", "folder_mode", "min_interval")


def _add_capture_flags(p: argparse.ArgumentParser):
    p.add_argument("--source", choices=["google", "mapillary"], help="imagery source (default google)")
    p.add_argument("--preset", choices=["current", "pano", "headings", "road"])
    p.add_argument("--heading-mode", dest="heading_mode", choices=["road", "fixed"],
                   help="batch heading: follow the road (default) or a fixed compass heading")
    p.add_argument("--fixed-heading", dest="fixed_heading", type=float)
    p.add_argument("--heading-count", dest="heading_count", type=int)
    p.add_argument("--pitch", type=float)
    p.add_argument("--fov", type=float)
    p.add_argument("--width", type=int)
    p.add_argument("--zoom", type=int, help="panorama zoom 0-5 (default 3 = 4096 px wide)")
    p.add_argument("--radius", type=int)
    p.add_argument("--folder")
    p.add_argument("--folder-mode", dest="folder_mode", choices=["single", "category", "set-per-point"])
    p.add_argument("--min-interval", dest="min_interval", type=float, help="seconds between upstream calls")


def _progress(job: Job):
    c = job.counts()
    sys.stdout.write(f"\r{job.state}: {c['done']} done ({c['files']} files), {c['noImage']} no coverage, "
                     f"{c['failed']} failed, {c['pending'] + c['running']} left of {c['total']}   ")
    sys.stdout.flush()


def cmd_run(args) -> int:
    api = validate_api_base(args.api)
    token_env = os.environ.get("SP_SURVEY_TOKEN")
    if token_env:
        get_token = lambda: token_env  # noqa: E731
    else:
        from . import auth
        if not auth.access_token(api):
            auth.login(api)
        get_token = lambda: auth.access_token(api)  # noqa: E731
    platform = PlatformClient(api, get_token)
    project = platform.get_project(args.project)
    options = dict(project.get("capture") or {})
    options.update({k: getattr(args, k) for k in OPTION_FLAGS if getattr(args, k, None) is not None})
    points = project.get("points") or []
    if args.selected:
        wanted = set(args.selected.split(","))
        points = [p for p in points if p.get("id") in wanted]
    if not points:
        print("No points in this project's street-level list. Add points in the Platform panel first.")
        return 1
    if options.get("source") == "mapillary":
        options["mapillary_token"] = os.environ.get("MAPILLARY_TOKEN", "")
    job = Job(points=points, options=options, media_prefix=project["mediaPrefix"],
              public_base=project.get("publicBase", ""), project_id=args.project)
    backend = make_backend(job.options, upstream_override=args.upstream_override,
                           mapillary_api=args.mapillary_api)
    asyncio.run(run_job(job, backend, platform, on_progress=_progress))
    print()
    if job.entries:
        platform.register(args.project, job.entries, sorted(job.folders), folder_tags(job.folders, job.options))
    failures = {pid: it["error"] for pid, it in job.items.items() if it["status"] == "failed"}
    if failures:
        print(json.dumps({"failed": failures}, indent=2)[:4000])
    print(f"{job.state}. Re-run the same command to resume; finished files are skipped.")
    return 0 if job.state == "done" else 2


def cmd_login(args) -> int:
    from . import auth
    auth.login(validate_api_base(args.api))
    print("Signed in.")
    return 0


def cmd_serve(args) -> int:
    origins = list(DEFAULT_ORIGINS) + list(args.allow_origin or [])
    serve(lambda opts: make_backend(opts, upstream_override=args.upstream_override, mapillary_api=args.mapillary_api),
          port=args.port, https_port=args.https_port, allowed_origins=origins)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m sp_streetlevel", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    s = sub.add_parser("serve", help="run the localhost helper used by the Platform Download button")
    s.add_argument("--port", type=int, default=DEFAULT_PORT, help="HTTP port (default %(default)s)")
    s.add_argument("--https-port", type=int, default=DEFAULT_HTTPS_PORT, help="HTTPS port (default %(default)s)")
    s.add_argument("--allow-origin", action="append", help="extra Platform origin allowed to call the helper")
    s.add_argument("--upstream-override", help=argparse.SUPPRESS)
    s.add_argument("--mapillary-api", help=argparse.SUPPRESS)
    s.set_defaults(func=cmd_serve)

    r = sub.add_parser("run", help="download every point of a project in one command (fallback)")
    r.add_argument("--project", required=True)
    r.add_argument("--api", default=DEFAULT_API)
    r.add_argument("--selected", help="comma-separated point ids")
    r.add_argument("--upstream-override", help=argparse.SUPPRESS)
    r.add_argument("--mapillary-api", help=argparse.SUPPRESS)
    _add_capture_flags(r)
    r.set_defaults(func=cmd_run)

    lg = sub.add_parser("login", help="sign in to the Platform for `run`")
    lg.add_argument("--api", default=DEFAULT_API)
    lg.set_defaults(func=cmd_login)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
