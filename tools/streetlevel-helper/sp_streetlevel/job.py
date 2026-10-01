"""Batch capture job: point → pano lookup → planned views → JPEG → media upload + metadata CSV."""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional

from . import __version__
from .core import (
    CSV_MODEL, SECRET_OPTIONS, capture_filename, folder_for_point, folder_tags, media_key, merge_rows, metadata_row,
    normalize_options, normalize_point, parse_csv, plan_views, render_perspective, rows_to_csv,
)
from .google import encode_jpeg
from .mapillary import ProviderAuthError
from .platform import AuthError, PlatformError

try:
    from importlib.metadata import version as _pkg_version
    STREETLEVEL_VERSION = _pkg_version("streetlevel")
except Exception:  # pragma: no cover
    STREETLEVEL_VERSION = "unknown"

ACQUISITION = f"streetlevel {STREETLEVEL_VERSION} via sp-streetlevel {__version__} (unofficial Google Street View endpoints)"
MAPILLARY_ACQUISITION = f"Mapillary Graph API v4 via sp-streetlevel {__version__}"
DONE = {"done", "no-image"}


class RateLimiter:
    """Minimum spacing between upstream calls (shared by lookups and panorama downloads)."""

    def __init__(self, min_interval: float, clock: Callable[[], float] = time.monotonic, sleep=asyncio.sleep):
        self.min_interval = min_interval
        self.clock = clock
        self.sleep = sleep
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self, weight: float = 1.0):
        async with self._lock:
            now = self.clock()
            if now < self._next:
                await self.sleep(self._next - now)
                now = self._next
            self._next = now + self.min_interval * weight


def _retryable(err: Exception) -> bool:
    if isinstance(err, (AuthError, ProviderAuthError)):
        return False
    if isinstance(err, PlatformError):
        return err.retryable
    return not isinstance(err, (ValueError, KeyError, TypeError))


async def with_retry(fn, attempts: int, sleep=asyncio.sleep, base_delay: float = 1.0):
    last = None
    for i in range(attempts):
        try:
            return await fn()
        except Exception as err:  # noqa: BLE001 - classified below
            last = err
            if not _retryable(err) or i == attempts - 1:
                break
            await sleep(base_delay * 2 ** i)
    raise last


class Job:
    def __init__(self, *, points: List[dict], options: dict, media_prefix: str, public_base: str = "",
                 project_id: str = "", job_id: Optional[str] = None):
        self.id = job_id or f"slj_{uuid.uuid4().hex[:10]}"
        self.project_id = project_id
        self.points = [p for p in (normalize_point(raw) for raw in points) if p]
        self.options = normalize_options(options)
        self.media_prefix = media_prefix if media_prefix.endswith("/") else media_prefix + "/"
        self.public_base = public_base.rstrip("/")
        self.state = "queued"
        self.error: Optional[str] = None
        self.items = {p["id"]: {"status": "pending", "keys": [], "error": None, "attempts": 0} for p in self.points}
        self.entries: List[dict] = []
        self.folders: set = set()
        self.csv_uploaded = 0
        self.cancelled = False
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at

    def counts(self) -> dict:
        c = {"total": len(self.points), "done": 0, "noImage": 0, "failed": 0, "pending": 0, "running": 0, "files": 0}
        files = set()
        for it in self.items.values():
            s = it["status"]
            if s == "done":
                c["done"] += 1
                files.update(it["keys"])
            elif s == "no-image":
                c["noImage"] += 1
            elif s == "failed":
                c["failed"] += 1
            elif s == "running":
                c["running"] += 1
            else:
                c["pending"] += 1
        c["files"] = len(files)
        return c

    def snapshot(self, since: int = 0) -> dict:
        return {
            "jobId": self.id,
            "projectId": self.project_id,
            "state": self.state,
            "error": self.error,
            "counts": self.counts(),
            "items": self.items,
            "entries": self.entries[since:],
            "entryCount": len(self.entries),
            "folders": sorted(self.folders),
            "tags": folder_tags(self.folders, self.options),
            "options": {k: v for k, v in self.options.items() if k not in SECRET_OPTIONS},
            "csvUploads": self.csv_uploaded,
            "updatedAt": self.updated_at,
        }

    def reset_unfinished(self):
        for it in self.items.values():
            if it["status"] not in DONE:
                it["status"] = "pending"
                it["error"] = None
        self.cancelled = False
        self.error = None


async def run_job(job: Job, backend, platform, *, sleep=asyncio.sleep, clock=time.monotonic,
                  on_progress: Optional[Callable[[Job], None]] = None, checkpoint_every: int = 5) -> Job:
    opts = job.options
    limiter = RateLimiter(opts["min_interval"], clock=clock, sleep=sleep)
    job.state = "running"
    touch = lambda: setattr(job, "updated_at", datetime.now(timezone.utc).isoformat())  # noqa: E731
    report = (lambda: (touch(), on_progress(job))) if on_progress else touch

    csv_key = f"{job.media_prefix}features/{CSV_MODEL}.csv"
    try:
        existing = await asyncio.to_thread(platform.list_keys, f"{job.media_prefix}{opts['folder']}/")
        text = await asyncio.to_thread(platform.fetch_public_text, f"{job.public_base}/{csv_key}" if job.public_base else "")
        csv_rows = parse_csv(text) if text else []
    except AuthError as err:
        job.state, job.error = "needs-auth", str(err)
        report()
        return job
    new_rows: List[dict] = []
    since_checkpoint = 0
    last_pano = {"id": None, "pixels": None}
    reported = {e["key"] for e in job.entries}

    async def flush_csv():
        nonlocal csv_rows, new_rows
        if not new_rows:
            return
        csv_rows = merge_rows(csv_rows, new_rows)
        new_rows = []
        data = rows_to_csv(csv_rows).encode("utf-8")
        await with_retry(lambda: asyncio.to_thread(platform.upload, csv_key, data, "text/csv;charset=utf-8"),
                         opts["max_attempts"], sleep)
        job.csv_uploaded += 1

    for index, point in enumerate(job.points):
        item = job.items[point["id"]]
        if job.cancelled:
            break
        if item["status"] in DONE:
            continue
        item.update(status="running", attempts=item["attempts"] + 1, error=None, keys=[])
        report()
        try:
            async def lookup():
                await limiter.wait(0.5)
                prefer = opts["fixed_heading"] if opts["heading_mode"] == "fixed" else None
                return await asyncio.to_thread(backend.lookup, point, opts["radius"], opts["search_third_party"], prefer)
            pano = await with_retry(lookup, opts["max_attempts"], sleep)
            if pano is None:
                item["status"] = "no-image"
                continue
            item["pano_id"] = pano.id
            folder = folder_for_point(point, opts, index)
            views = plan_views(point, pano, opts)
            names = [capture_filename(pano.id, v, pano.provider) for v in views]
            keys = [media_key(job.media_prefix, folder, n) for n in names]
            missing = [i for i, k in enumerate(keys) if k not in existing]
            equirect = None
            if missing and last_pano["id"] == pano.id:
                equirect = last_pano["pixels"]
            elif missing:
                async def fetch():
                    await limiter.wait(1.0)
                    return await backend.fetch_equirect(pano, opts["zoom"])
                equirect = await with_retry(fetch, opts["max_attempts"], sleep)
                last_pano.update(id=pano.id, pixels=equirect)
            now = datetime.now(timezone.utc).isoformat()
            for i, (view, name, key) in enumerate(zip(views, names, keys)):
                if view["kind"] in ("pano", "original"):
                    height, width = equirect.shape[:2] if equirect is not None else ("", "")
                else:
                    width, height = opts["width"], round(opts["width"] * 3 / 4)
                url = f"{job.public_base}/{key}" if job.public_base else ""
                if i in missing:
                    pixels = equirect if view["kind"] in ("pano", "original") else render_perspective(
                        equirect, view["heading"], view["pitch"], view["fov"], width, height, pano.heading)
                    data = encode_jpeg(pixels, opts["jpeg_quality"])
                    url = await with_retry(lambda d=data, k=key: asyncio.to_thread(platform.upload, k, d, "image/jpeg"),
                                           opts["max_attempts"], sleep) or url
                    existing.add(key)
                item["keys"].append(key)
                job.folders.add(folder)
                if key in reported:
                    continue
                reported.add(key)
                job.entries.append({
                    "url": url, "name": name, "key": key, "media_id": key, "folder": folder, "type": "image",
                    "attribution": {
                        "text": pano.copyright or ("Mapillary" if pano.provider == "mapillary" else "Google"),
                        "url": pano.link,
                        "license": pano.license or "Google Street View (unofficial download)",
                    },
                    "streetLevel": {"provider": pano.provider, "panoId": pano.id, "pointId": point["id"], "runId": job.id},
                })
                new_rows.append(metadata_row(key=key, name=name, folder=folder, pano=pano, view=view, point=point,
                                             width=width, height=height, zoom=opts["zoom"], run_id=job.id,
                                             now=now, acquisition=MAPILLARY_ACQUISITION if pano.provider == "mapillary" else ACQUISITION))
            item["status"] = "done"
        except AuthError as err:
            item.update(status="pending", error=str(err))
            job.state, job.error = "needs-auth", str(err)
            break
        except ProviderAuthError as err:
            item.update(status="pending", error=str(err))
            job.state, job.error = "failed", str(err)
            break
        except Exception as err:  # noqa: BLE001 - recorded per point
            item.update(status="failed", error=str(err)[:300])
        finally:
            since_checkpoint += 1
            if since_checkpoint >= checkpoint_every:
                since_checkpoint = 0
                try:
                    await flush_csv()
                except AuthError as err:
                    job.state, job.error = "needs-auth", str(err)
            report()
        if job.state in ("needs-auth", "failed"):
            break

    if job.state not in ("needs-auth",):
        try:
            await flush_csv()
        except AuthError as err:
            job.state, job.error = "needs-auth", str(err)
        except Exception as err:  # noqa: BLE001
            job.error = f"Metadata CSV upload failed: {err}"
    if job.state == "running":
        counts = job.counts()
        job.state = "cancelled" if job.cancelled else ("partial" if counts["failed"] or counts["pending"] else "done")
    report()
    return job
