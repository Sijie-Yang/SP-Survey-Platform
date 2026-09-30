"""Pure helpers: points, options, view planning, re-projection, file names, metadata CSV."""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field
from typing import Iterable, List, Optional

import numpy as np

PRESETS = ("current", "pano", "headings", "road")
FOLDER_MODES = ("single", "category", "set-per-point")
PROVIDER = "google_streetview"
CSV_MODEL = "street_level_v1"

DEFAULT_OPTIONS = {
    "preset": "current",
    "heading_count": 4,
    "pitch": 0.0,
    "fov": 90.0,
    "width": 1024,
    "zoom": 3,
    "radius": 50,
    "folder": "street-level",
    "folder_mode": "category",
    "search_third_party": False,
    "min_interval": 1.5,
    "max_attempts": 3,
    "jpeg_quality": 86,
}

_OPTION_ALIASES = {
    "headingCount": "heading_count",
    "folderMode": "folder_mode",
    "searchThirdParty": "search_third_party",
    "minInterval": "min_interval",
    "maxAttempts": "max_attempts",
    "jpegQuality": "jpeg_quality",
}

CSV_HEADERS = [
    "media_id", "name", "folder", "provider", "pano_id", "captured_at", "lat", "lng",
    "pano_heading", "is_third_party", "view_kind", "heading", "pitch", "fov", "road_offset",
    "width", "height", "zoom",
    "point_id", "point_label", "point_lat", "point_lng", "point_heading", "point_pitch", "point_fov",
    "point_pano_id", "point_source", "point_source_url", "distance_m",
    "copyright", "uploader", "source", "acquisition", "attribution_url", "run_id", "downloaded_at",
]

EARTH_RADIUS_M = 6371008.8


def _num(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def normalize_heading(value) -> Optional[float]:
    n = _num(value)
    return None if n is None else round(n % 360.0, 2)


def normalize_options(raw: Optional[dict] = None) -> dict:
    opts = dict(DEFAULT_OPTIONS)
    for key, value in (raw or {}).items():
        opts[_OPTION_ALIASES.get(key, key)] = value
    opts["preset"] = opts["preset"] if opts["preset"] in PRESETS else "current"
    opts["folder_mode"] = opts["folder_mode"] if opts["folder_mode"] in FOLDER_MODES else "category"
    opts["heading_count"] = int(_clamp(int(_num(opts["heading_count"]) or 4), 1, 12))
    opts["pitch"] = float(_clamp(_num(opts["pitch"]) or 0.0, -90, 90))
    opts["fov"] = float(_clamp(_num(opts["fov"]) or 90.0, 10, 120))
    opts["width"] = int(_clamp(int(_num(opts["width"]) or 1024), 256, 2048))
    opts["zoom"] = int(_clamp(int(_num(opts["zoom"]) if _num(opts["zoom"]) is not None else 3), 0, 5))
    opts["radius"] = int(_clamp(int(_num(opts["radius"]) or 50), 5, 200))
    opts["folder"] = normalize_folder(opts.get("folder") or "street-level") or "street-level"
    opts["search_third_party"] = bool(opts["search_third_party"])
    opts["min_interval"] = float(_clamp(_num(opts["min_interval"]) or 0.0, 0.0, 60.0))
    opts["max_attempts"] = int(_clamp(int(_num(opts["max_attempts"]) or 3), 1, 6))
    opts["jpeg_quality"] = int(_clamp(int(_num(opts["jpeg_quality"]) or 86), 50, 95))
    return opts


def normalize_folder(path: str) -> str:
    segs = [re.sub(r"[^a-zA-Z0-9._-]+", "_", s).strip("_") for s in str(path or "").split("/")]
    return "/".join(s for s in segs if s and s not in (".", ".."))


def normalize_point(raw: dict) -> Optional[dict]:
    lat = _num(raw.get("lat", raw.get("latitude")))
    lng = _num(raw.get("lng", raw.get("lon", raw.get("longitude"))))
    if lat is None or lng is None or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None
    pitch = _num(raw.get("pitch"))
    fov = _num(raw.get("fov"))
    return {
        "id": str(raw.get("id") or f"pt_{lat:.6f}_{lng:.6f}"),
        "lat": lat,
        "lng": lng,
        "heading": normalize_heading(raw.get("heading")),
        "pitch": None if pitch is None else _clamp(pitch, -90, 90),
        "fov": None if fov is None else _clamp(fov, 1, 180),
        "pano_id": (str(raw.get("panoId") or raw.get("pano_id") or "").strip() or None),
        "road_bearing": normalize_heading(raw.get("roadBearing", raw.get("road_bearing"))),
        "label": str(raw.get("label") or "")[:200],
        "source": str(raw.get("source") or ""),
        "source_url": str(raw.get("sourceUrl") or raw.get("source_url") or "") or None,
    }


def distance_m(a_lat, a_lng, b_lat, b_lng) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    s = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(s)))


def bearing_deg(a_lat, a_lng, b_lat, b_lng) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lng - a_lng)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def angle_diff(a: float, b: float) -> float:
    return abs(((a - b) + 540.0) % 360.0 - 180.0)


@dataclass
class PanoInfo:
    id: str
    lat: float
    lng: float
    heading: float = 0.0
    date: str = ""
    is_third_party: bool = False
    copyright: str = ""
    uploader: str = ""
    source: str = ""
    links: List[float] = field(default_factory=list)
    raw: object = None


def road_base(point: dict, pano: PanoInfo) -> float:
    if point.get("road_bearing") is not None:
        return point["road_bearing"]
    if pano.links:
        ref = point["heading"] if point.get("heading") is not None else pano.heading
        return min(pano.links, key=lambda d: angle_diff(d, ref))
    if point.get("heading") is not None:
        return point["heading"]
    return pano.heading


def plan_views(point: dict, pano: PanoInfo, options: dict) -> List[dict]:
    pitch = point["pitch"] if point.get("pitch") is not None else options["pitch"]
    fov = point["fov"] if point.get("fov") is not None else options["fov"]
    fov = _clamp(fov, 10, 120)
    preset = options["preset"]
    if preset == "pano":
        return [{"kind": "pano"}]
    if preset == "headings":
        n = options["heading_count"]
        start = point["heading"] if point.get("heading") is not None else 0.0
        return [{"kind": "view", "heading": (start + 360.0 / n * i) % 360.0, "pitch": pitch, "fov": fov} for i in range(n)]
    if preset == "road":
        base = road_base(point, pano)
        return [{"kind": "view", "heading": (base + off) % 360.0, "pitch": pitch, "fov": fov, "road_offset": off}
                for off in (0, 90, 180, 270)]
    if point.get("heading") is not None:
        heading = point["heading"]
    elif distance_m(pano.lat, pano.lng, point["lat"], point["lng"]) > 3:
        heading = bearing_deg(pano.lat, pano.lng, point["lat"], point["lng"])
    else:
        heading = pano.heading
    return [{"kind": "view", "heading": heading, "pitch": pitch, "fov": fov}]


def capture_filename(pano_id: str, view: dict) -> str:
    pid = re.sub(r"[^a-zA-Z0-9_-]", "_", str(pano_id))
    if view["kind"] == "pano":
        return f"gsv-{pid}-pano.jpg"
    h = int(round(view["heading"])) % 360
    p = int(round(view.get("pitch") or 0))
    f = int(round(view.get("fov") or 90))
    return f"gsv-{pid}-h{h:03d}-{'m' if p < 0 else 'p'}{abs(p):02d}-f{f:03d}.jpg"


def folder_for_point(point: dict, options: dict, index: int) -> str:
    base = options["folder"]
    if options["folder_mode"] != "set-per-point":
        return base
    label = normalize_folder(point.get("label") or "").replace("/", "_")
    name = label or f"p{index + 1:04d}_{normalize_folder(point['id'])[-6:]}"
    return normalize_folder(f"{base}/{name}")


def folder_tags(folders: Iterable[str], options: dict) -> dict:
    base = options["folder"]
    if options["folder_mode"] == "category":
        return {base: "category"}
    if options["folder_mode"] == "set-per-point":
        return {f: "set" for f in folders if f and f != base}
    return {}


def media_key(prefix: str, folder: str, name: str) -> str:
    prefix = prefix if prefix.endswith("/") else prefix + "/"
    return f"{prefix}{folder}/{name}" if folder else f"{prefix}{name}"


def render_perspective(equirect: np.ndarray, heading: float, pitch: float, fov: float,
                       width: int, height: int, pano_heading: float) -> np.ndarray:
    """Equirectangular (H×W×3, centre column facing `pano_heading`) → perspective view, bilinear."""
    sh, sw = equirect.shape[:2]
    f = (width / 2) / math.tan(math.radians(_clamp(fov, 1, 179)) / 2)
    cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    yaw = math.radians(heading - pano_heading)
    xs = np.arange(width) - width / 2 + 0.5
    ys = height / 2 - np.arange(height) - 0.5
    dx, dy = np.meshgrid(xs, ys)
    yy = dy * cp + f * sp
    zz = -dy * sp + f * cp
    lon = np.arctan2(dx, zz) + yaw
    lat = np.arctan2(yy, np.hypot(dx, zz))
    u = (lon / (2 * math.pi) + 0.5) * sw - 0.5
    v = np.clip((0.5 - lat / math.pi) * sh - 0.5, 0, sh - 1)
    u = np.mod(u, sw)
    x0 = np.floor(u).astype(np.int64) % sw
    y0 = np.floor(v).astype(np.int64)
    x1 = (x0 + 1) % sw
    y1 = np.minimum(y0 + 1, sh - 1)
    fx = (u - np.floor(u))[..., None]
    fy = (v - y0)[..., None]
    src = equirect.astype(np.float32)
    top = src[y0, x0] * (1 - fx) + src[y0, x1] * fx
    bot = src[y1, x0] * (1 - fx) + src[y1, x1] * fx
    return np.clip(top * (1 - fy) + bot * fy + 0.5, 0, 255).astype(np.uint8)


def attribution_url(pano: PanoInfo) -> str:
    return ("https://www.google.com/maps/@?api=1&map_action=pano"
            f"&pano={pano.id}&viewpoint={pano.lat:.7f}%2C{pano.lng:.7f}")


def metadata_row(*, key, name, folder, pano: PanoInfo, view, point, width, height, zoom,
                 run_id, now, acquisition) -> dict:
    return {
        "media_id": key,
        "name": name,
        "folder": folder,
        "provider": PROVIDER,
        "pano_id": pano.id,
        "captured_at": pano.date,
        "lat": round(pano.lat, 7),
        "lng": round(pano.lng, 7),
        "pano_heading": round(pano.heading, 2),
        "is_third_party": pano.is_third_party,
        "view_kind": view["kind"],
        "heading": "" if view.get("heading") is None else round(view["heading"], 2),
        "pitch": view.get("pitch", ""),
        "fov": view.get("fov", ""),
        "road_offset": view.get("road_offset", ""),
        "width": width,
        "height": height,
        "zoom": zoom,
        "point_id": point["id"],
        "point_label": point.get("label") or "",
        "point_lat": point["lat"],
        "point_lng": point["lng"],
        "point_heading": "" if point.get("heading") is None else point["heading"],
        "point_pitch": "" if point.get("pitch") is None else point["pitch"],
        "point_fov": "" if point.get("fov") is None else point["fov"],
        "point_pano_id": point.get("pano_id") or "",
        "point_source": point.get("source") or "",
        "point_source_url": point.get("source_url") or "",
        "distance_m": round(distance_m(pano.lat, pano.lng, point["lat"], point["lng"]), 1),
        "copyright": pano.copyright,
        "uploader": pano.uploader,
        "source": pano.source,
        "acquisition": acquisition,
        "attribution_url": attribution_url(pano),
        "run_id": run_id,
        "downloaded_at": now,
    }


def rows_to_csv(rows: Iterable[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_HEADERS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in CSV_HEADERS})
    return "\ufeff" + buf.getvalue()


def parse_csv(text: str) -> List[dict]:
    text = (text or "").lstrip("\ufeff")
    if not text.strip():
        return []
    return list(csv.DictReader(io.StringIO(text)))


def merge_rows(existing: Iterable[dict], incoming: Iterable[dict]) -> List[dict]:
    by_id = {}
    for row in list(existing) + list(incoming):
        if row.get("media_id"):
            by_id[row["media_id"]] = row
    return list(by_id.values())
