"""``spsurvey`` command line: login, list projects, pull results."""
from __future__ import annotations

import argparse
import json
import sys

from . import __version__, auth
from .client import Client
from .errors import SPSurveyError


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="spsurvey", description="SP-Survey command line")
    parser.add_argument("--base-url", help="Platform URL (default https://sp-survey.org or SPSURVEY_BASE_URL)")
    parser.add_argument("--version", action="version", version=f"spsurvey {__version__}")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_login = sub.add_parser("login", help="Approve access in the browser and store the token")
    p_login.add_argument("--no-browser", action="store_true", help="Print the link instead of opening a browser")
    sub.add_parser("logout", help="Forget the stored token")
    sub.add_parser("whoami", help="Show where the token comes from and which tools are available")
    sub.add_parser("projects", help="List your projects")

    p_url = sub.add_parser("url", help="Print the participant link of a project")
    p_url.add_argument("project_id")

    p_pub = sub.add_parser("publish", help="Release the saved draft to the participant link")
    p_pub.add_argument("project_id")
    p_pub.add_argument("--summary", default="")

    p_up = sub.add_parser("upload", help="Upload the images of a folder into a project")
    p_up.add_argument("project_id")
    p_up.add_argument("folder")
    p_up.add_argument("--into", default="", help="Media-library folder name")

    p_res = sub.add_parser("results", help="Write results to disk")
    p_res.add_argument("project_id")
    p_res.add_argument("--format", choices=["wide_csv", "json", "analysis_bundle", "dataset_package"], default="wide_csv")
    p_res.add_argument("--out", default=".", help="Output file or folder")
    p_res.add_argument("--data-source", choices=["human", "practice", "silicon"], default=None)
    p_res.add_argument("--exclude-flagged", action="store_true")

    args = parser.parse_args(argv)
    try:
        return _run(args)
    except SPSurveyError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1


def _run(args) -> int:
    if args.cmd == "login":
        creds = auth.login(base_url=args.base_url, open_browser=not args.no_browser)
        print(f"Logged in to {creds['base_url']} (scopes: {creds.get('scope') or 'default'}). Token stored in {auth.credentials_path()}")
        return 0
    if args.cmd == "logout":
        auth.clear_credentials()
        print("Stored token removed.")
        return 0

    sp = Client(base_url=args.base_url)
    if args.cmd == "whoami":
        source = "SPSURVEY_TOKEN" if auth.ENV_TOKEN in __import__("os").environ else str(auth.credentials_path())
        print(f"base url: {sp.base_url}\ntoken from: {source}\ntools: {', '.join(sp.tools())}")
        return 0
    if args.cmd == "projects":
        for p in sp.list_projects():
            print(f"{p.id}\t{p.name}\tv{p.published_version}\t{p.updated_at or ''}")
        return 0
    if args.cmd == "url":
        print(sp.urls(args.project_id).get("liveSurvey", ""))
        return 0
    if args.cmd == "publish":
        rel = sp.publish(args.project_id, summary=args.summary)
        print(f"Published version {rel.version}: {rel.live_url}")
        return 0
    if args.cmd == "upload":
        done = sp.upload_images(args.project_id, args.folder, folder=args.into, on_progress=lambda i, n, p: print(f"[{i}/{n}] {p.name}"))
        print(f"Uploaded {len(done)} file(s).")
        return 0
    if args.cmd == "results":
        filters = {"data_source": args.data_source, "exclude_flagged": args.exclude_flagged or None}
        from pathlib import Path
        out = Path(args.out)
        if args.format == "wide_csv":
            target = out if out.suffix else out / f"responses_wide_{args.project_id}.csv"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(sp.responses_wide_csv(args.project_id, **filters), "utf-8")
        elif args.format == "json":
            target = out if out.suffix else out / f"responses_{args.project_id}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(sp.responses(args.project_id, **filters), indent=2), "utf-8")
        elif args.format == "analysis_bundle":
            from .client import write_files_zip
            target = write_files_zip(sp.analysis_bundle(args.project_id, **filters), out if out.suffix == ".zip" else out / f"analysis_{args.project_id}.zip")
        else:
            target = sp.download_dataset_package(args.project_id, out, **filters)
        print(str(target))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
