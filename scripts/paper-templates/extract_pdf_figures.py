#!/usr/bin/env python3
"""Pull usable figures out of the paper PDFs into builtin template libraries.

Templates that already have a Hugging Face dataset or an images.json library
are left alone. Street photographs become the survey pool. Charts, maps and
interface screenshots are classified, then left out of the library.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_DIR = ROOT / "public" / "project_templates"
PDF_DIR = Path("/Users/sijieyang/Documents/SP-Survey-Papers/Template Papers")

# Folder the survey questions should sample. None = stills only (video study).
STIMULUS_FOLDER = {
    "2009-ewing-measuring": None,
    "2013-salesses-collaborative": "paper",
    "2014-quercia-aesthetic": "paper",
    "2014-naik-streetscore": "paper",
    "2016-dubey-place": "paper",
    "2017-liu-machine": "Beijing",
    "2017-seresinhe-scenic": "paper",
    "2019-yao-human": "paper",
    "2021-ramirez-measuring": "PlacePulse2",
    "2021-kruse-places": "Boston",
    "2022-qiu-subjective": "Shanghai",
    "2023-kang-assessing": "Stockholm",
    "2025-danish-citizen": "Amsterdam",
    "2026-kang-decoding": "Helsingborg",
}

IMAGE_QUESTION_TYPES = {
    "imagepicker",
    "imagerating",
    "imageboolean",
    "imagematrix",
    "imageslidergroup",
    "imageannotation",
    "imageranking",
}

MAX_EDGE = 1400
JPEG_QUALITY = 82


def has_library(template_id: str, data: dict) -> bool:
    if data.get("huggingfaceDataset"):
        return True
    return (TEMPLATE_DIR / template_id / "images.json").exists()


def pixmap_image(doc, xref) -> Image.Image | None:
    try:
        pix = pymupdf.Pixmap(doc, xref)
        if pix.n != 3 or pix.alpha:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        if pix.n != 3:
            return None
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    except Exception:
        return None


def metrics(im: Image.Image) -> dict:
    small = im.convert("RGB").resize((48, 48))
    px = list(small.getdata())
    n = len(px)
    white = black = colorful = 0
    acc = 0
    for r, g, b in px:
        acc += r + g + b
        if r > 235 and g > 235 and b > 235:
            white += 1
        if r < 28 and g < 28 and b < 28:
            black += 1
        mx, mn = max(r, g, b), min(r, g, b)
        if mx and (mx - mn) / mx > 0.18:
            colorful += 1
    mean = acc / (n * 3)
    var = sum((c - mean) ** 2 for p in px for c in p) / (n * 3)
    return {
        "white": white / n,
        "black": black / n,
        "colorful": colorful / n,
        "var": var,
    }


def is_page_scan(im: Image.Image) -> bool:
    w, h = im.size
    return w > 1800 and h > 2400


def block_flat_fraction(im: Image.Image) -> float:
    small = im.convert("RGB").resize((96, 96))
    px = small.load()
    flats = total = 0
    for y in range(0, 96, 12):
        for x in range(0, 96, 12):
            lum = []
            for yy in range(y, y + 12):
                for xx in range(x, x + 12):
                    r, g, b = px[xx, yy]
                    lum.append((r + g + b) / 3)
            mean = sum(lum) / len(lum)
            std = (sum((v - mean) ** 2 for v in lum) / len(lum)) ** 0.5
            total += 1
            if std < 12:
                flats += 1
    return flats / total


def overlay_fraction(im: Image.Image) -> float:
    """Share of pixels that are a flat, highly saturated paint color."""
    small = im.convert("RGB").resize((64, 64))
    hit = n = 0
    for r, g, b in small.getdata():
        n += 1
        mx, mn = max(r, g, b), min(r, g, b)
        if mx > 90 and mx - mn > 90 and (mx - mn) / mx > 0.55:
            hit += 1
    return hit / n


def looks_like_map(im: Image.Image) -> bool:
    """Basemaps and choropleth plates. Blue sky in a street photo is ignored."""
    small = im.convert("RGB").resize((64, 64))
    px = list(small.getdata())
    n = len(px)
    blue = pale = saturated = top_blue = 0
    for i, (r, g, b) in enumerate(px):
        is_blue = b > 145 and b > r + 18 and b > g + 8
        if is_blue:
            blue += 1
            if i < n // 3:
                top_blue += 1
        if min(r, g, b) > 165 and max(r, g, b) - min(r, g, b) < 40:
            pale += 1
        mx, mn = max(r, g, b), min(r, g, b)
        if mx > 80 and (mx - mn) / max(mx, 1) > 0.45:
            saturated += 1
    pale_r, blue_r, sat_r = pale / n, blue / n, saturated / n
    # A place photograph is not mostly blank paper. Basemaps and charts are.
    if pale_r > 0.58:
        return True
    sky = blue > 8 and top_blue / blue > 0.72
    if not sky and blue_r > 0.1 and pale_r > 0.32:
        return True
    if pale_r > 0.42 and sat_r > 0.12 and block_flat_fraction(im) > 0.2:
        return True
    return False


def is_diagram(im: Image.Image) -> bool:
    """Maps, charts and icons use few colors. Photographs do not."""
    small = im.convert("RGB").resize((48, 48))
    colors = small.getcolors(320)
    if not colors:
        return False
    colors.sort(reverse=True)
    top = sum(count for count, _ in colors[:6]) / (48 * 48)
    return top > 0.5


def looks_like_scene(im: Image.Image, m: dict | None = None) -> bool:
    """A single place photograph, not a map, chart, or segmentation overlay."""
    m = m or metrics(im)
    w, h = im.size
    if min(w, h) < 140:
        return False
    aspect = w / max(1, h)
    if not (0.45 <= aspect <= 2.6):
        return False
    if m["var"] < 400 or m["black"] > 0.15 or m["white"] > 0.55:
        return False
    if m["colorful"] < 0.12:
        return False
    if block_flat_fraction(im) > 0.62:
        return False
    if overlay_fraction(im) > 0.22 or looks_like_map(im) or is_diagram(im):
        return False
    return True


def classify(im: Image.Image, template_id: str) -> str:
    """stimulus | figure | skip."""
    if is_page_scan(im):
        return "skip"
    w, h = im.size
    m = metrics(im)
    if min(w, h) < 140 or m["var"] < 80 or m["white"] > 0.92:
        return "skip"
    # Publisher icons and toolbar glyphs.
    if m["black"] > 0.22 and m["colorful"] < 0.2:
        return "skip"
    if m["white"] > 0.72 and m["colorful"] < 0.16:
        return "skip"
    if looks_like_scene(im, m):
        return "stimulus"
    if is_diagram(im) and max(w, h) < 900 and (m["black"] > 0.12 or m["white"] > 0.4 or m["colorful"] < 0.25):
        return "skip"
    if max(w, h) < 360:
        return "skip"
    return "figure"


def gutter_mask(im: Image.Image, dark: bool) -> tuple[list[bool], list[bool]]:
    """Rows and columns that are a flat gap between panels, not a bright sky."""
    g = im.convert("L")
    w, h = g.size
    px = g.load()
    # Sample every pixel. Panel gaps are often only a few pixels wide.
    xstep = 1
    ystep = 1

    def is_gap(vals: list[int]) -> bool:
        mean = sum(vals) / len(vals)
        std = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
        if dark:
            return mean < 28 and std < 14
        return mean > 236 and std < 18

    rows = []
    for y in range(h):
        rows.append(is_gap([px[x, y] for x in range(0, w, xstep)]))
    cols = []
    for x in range(w):
        cols.append(is_gap([px[x, y] for y in range(0, h, ystep)]))
    return rows, cols


def content_spans(mask: list[bool], min_len: int) -> list[tuple[int, int]]:
    spans = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            i += 1
            continue
        j = i
        while j < n and not mask[j]:
            j += 1
        if j - i >= min_len:
            spans.append((i, j))
        i = j
    return spans


def split_grid(im: Image.Image, depth: int = 0) -> list[Image.Image]:
    """Cut a panel of street photos out of a white- or black-guttered figure."""
    w, h = im.size
    if w < 400 or h < 280 or depth > 2:
        return []
    best: list[Image.Image] = []
    for dark in (False, True):
        rows, cols = gutter_mask(im, dark)
        row_spans = content_spans(rows, 90)
        col_spans = content_spans(cols, 90)
        if len(row_spans) < 1 or len(col_spans) < 1:
            continue
        if len(row_spans) * len(col_spans) < 2:
            continue
        if len(row_spans) * len(col_spans) > 30:
            continue
        cells = []
        for y0, y1 in row_spans:
            for x0, x1 in col_spans:
                if x1 - x0 < 120 or y1 - y0 < 90:
                    continue
                cell = im.crop((x0, y0, x1, y1))
                if looks_like_scene(cell):
                    cells.append(cell)
                elif depth < 2:
                    nested = split_grid(cell, depth + 1)
                    cells.extend(nested)
        if len(cells) > len(best):
            best = cells
    if len(best) >= 2:
        return best
    seamed = split_on_seams(im)
    return seamed if len(seamed) > len(best) else best


def seam_indexes(im: Image.Image, axis: str) -> list[int]:
    """Bright hairline gaps between photos that share an edge."""
    g = im.convert("L")
    w, h = g.size
    px = g.load()
    if axis == "x":
        means = [sum(px[x, y] for y in range(0, h, 2)) / max(1, (h + 1) // 2) for x in range(w)]
        length = w
    else:
        means = [sum(px[x, y] for x in range(0, w, 2)) / max(1, (w + 1) // 2) for y in range(h)]
        length = h
    seams = []
    i = 8
    while i < length - 8:
        if means[i] > 155 and means[i] > means[i - 6] + 28 and means[i] > means[i + 6] + 28:
            seams.append(i)
            i += 24
        else:
            i += 1
    return seams


def split_on_seams(im: Image.Image) -> list[Image.Image]:
    w, h = im.size
    if w < 400 or h < 180:
        return []
    xs = seam_indexes(im, "x")
    ys = seam_indexes(im, "y")
    if not xs and not ys:
        return []
    xcuts = [0, *xs, w]
    ycuts = [0, *ys, h]

    def regular(cuts: list[int]) -> bool:
        widths = [b - a for a, b in zip(cuts, cuts[1:]) if b - a > 40]
        if len(widths) < 2:
            return False
        return max(widths) <= min(widths) * 1.55

    if xs and not regular(xcuts):
        xcuts = [0, w]
    if ys and not regular(ycuts):
        ycuts = [0, h]
    if len(xcuts) * len(ycuts) < 3 and not (len(xcuts) >= 2 and len(ycuts) >= 2):
        if len(xcuts) < 3 and len(ycuts) < 3:
            return []
    if len(xcuts) * len(ycuts) > 40:
        return []
    cells = []
    for y0, y1 in zip(ycuts, ycuts[1:]):
        for x0, x1 in zip(xcuts, xcuts[1:]):
            if x1 - x0 < 120 or y1 - y0 < 90:
                continue
            cell = im.crop((x0 + 2, y0 + 2, x1 - 2, y1 - 2))
            if looks_like_scene(cell):
                cells.append(cell)
    return cells if len(cells) >= 2 else []


def ahash(im: Image.Image) -> int:
    tiny = im.convert("L").resize((8, 8))
    px = list(tiny.getdata())
    avg = sum(px) / len(px)
    bits = 0
    for i, v in enumerate(px):
        if v >= avg:
            bits |= 1 << i
    return bits


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def save_jpeg(im: Image.Image, path: Path) -> None:
    im = im.convert("RGB")
    w, h = im.size
    scale = MAX_EDGE / max(w, h)
    if scale < 1:
        im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", quality=JPEG_QUALITY, optimize=True)


def crop_nasar_map(doc) -> Image.Image | None:
    """Figure 1 is drawn inside a scanned page, not stored as its own image."""
    if doc.page_count < 3:
        return None
    pix = doc[2].get_pixmap(dpi=150, alpha=False)
    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    g = im.convert("L")
    w, h = g.size
    px = g.load()
    ink_rows = []
    x0, x1 = int(w * 0.06), int(w * 0.94)
    for y in range(int(h * 0.48), int(h * 0.90)):
        dark = 0
        checked = 0
        for x in range(x0, x1, 2):
            checked += 1
            if px[x, y] < 90:
                dark += 1
        if dark / checked > 0.04:
            ink_rows.append(y)
    if len(ink_rows) < 40:
        return None
    # Longest contiguous ink band is the map; the caption is a thin separate band.
    bands = []
    start = prev = ink_rows[0]
    for y in ink_rows[1:]:
        if y > prev + 8:
            bands.append((start, prev))
            start = y
        prev = y
    bands.append((start, prev))
    y0, y1 = max(bands, key=lambda b: b[1] - b[0])
    xs = []
    for x in range(x0, x1):
        if any(px[x, y] < 90 for y in range(y0, y1, 3)):
            xs.append(x)
    if len(xs) < 40:
        return None
    pad = 8
    box = (max(0, xs[0] - pad), max(0, y0 - pad), min(w, xs[-1] + pad), min(h, y1 + pad))
    return im.crop(box)


def extract_template(template_id: str) -> list[dict]:
    if template_id == "1990-nasar-evaluative":
        return []
    pdf = PDF_DIR / f"{template_id}.pdf"
    doc = pymupdf.open(pdf)
    seen_xref = set()
    hashes: list[int] = []
    saved: list[dict] = []
    seq = 0

    def keep(im: Image.Image, kind: str, page_no: int) -> None:
        nonlocal seq
        digest = ahash(im)
        if any(hamming(digest, prev) <= 4 for prev in hashes):
            return
        hashes.append(digest)
        seq += 1
        folder = STIMULUS_FOLDER[template_id] if kind == "stimulus" else "figures"
        if kind == "stimulus" and folder is None:
            kind = "figure"
            folder = "figures"
        name = f"p{page_no:02d}-{seq:02d}.jpg"
        saved.append({
            "im": im,
            "kind": kind,
            "folder": folder,
            "name": name,
            "page": page_no,
        })

    for page_index in range(doc.page_count):
        page = doc[page_index]
        for img in page.get_images(full=True):
            xref = img[0]
            if xref in seen_xref:
                continue
            seen_xref.add(xref)
            im = pixmap_image(doc, xref)
            if im is None:
                continue
            kind = classify(im, template_id)
            if kind == "skip":
                continue
            cells = split_grid(im) if kind != "stimulus" else []
            if cells:
                keep(im, "figure", page_index + 1)
                for cell in cells:
                    keep(cell, "stimulus", page_index + 1)
            else:
                keep(im, kind, page_index + 1)
    doc.close()
    return saved


def contact_sheet(items: list[dict], path: Path) -> None:
    if not items:
        return
    thumb = 180
    cols = 6
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb, rows * (thumb + 18)), (245, 245, 245))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(sheet)
    for i, item in enumerate(items):
        im = item["im"].copy()
        im.thumbnail((thumb - 8, thumb - 22))
        c, r = i % cols, i // cols
        x, y = c * thumb + 4, r * (thumb + 18) + 16
        color = (30, 140, 60) if item["kind"] == "stimulus" else (30, 80, 160)
        draw.rectangle((c * thumb, r * (thumb + 18), (c + 1) * thumb - 1, (r + 1) * (thumb + 18) - 1), outline=color, width=3)
        sheet.paste(im, (x, y))
        draw.text((c * thumb + 4, r * (thumb + 18) + 2), item["kind"][:3], fill=color)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "JPEG", quality=70)


def walk_elements(elements, fn):
    for el in elements or []:
        fn(el)
        walk_elements(el.get("elements"), fn)


def patch_description(text: str, stimulus_n: int, template_id: str = "") -> str:
    text = re.sub(
        r"\s*Bundled images are (?:figures|photographs) from the paper PDF \([^)]*\), not the original full stimulus set\.",
        "",
        text or "",
    ).rstrip()
    if stimulus_n <= 0:
        return text
    label = f"{stimulus_n} scene" if stimulus_n == 1 else f"{stimulus_n} scenes"
    note = (
        f"Bundled images are photographs from the paper PDF"
        f" ({label}), not the original full stimulus set."
    )
    replacements = [
        "Researchers supply their own street-view images (street-view terms do not allow redistribution).",
        "Researchers supply their own street-view images.",
        "No sample images are bundled; researchers supply GSV and Geograph images.",
        "Researchers supply the Place Pulse 2.0 images.",
        'Upload one city map to the "map" folder; both mark-up pages show it.',
    ]
    for old in replacements:
        if old in text:
            return text.replace(old, note)
    if "Bundled images are photographs from the paper PDF" in text:
        return text
    return text.rstrip() + " " + note


def apply_template(template_id: str, items: list[dict]) -> None:
    if template_id == "1990-nasar-evaluative":
        print("skip 1990-nasar-evaluative: map questions must not regain an image library")
        return
    stimuli = [item for item in items if item["kind"] == "stimulus"]
    dest = TEMPLATE_DIR / template_id
    if dest.exists():
        for old in dest.rglob("*"):
            if old.is_file() and old.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                old.unlink()
        figures = dest / "figures"
        if figures.is_dir():
            for old in figures.rglob("*"):
                if old.is_file():
                    old.unlink()
            figures.rmdir()
    rels = []
    for item in stimuli:
        rel = f"{item['folder']}/{item['name']}"
        save_jpeg(item["im"], dest / rel)
        rels.append(rel)
    if rels:
        manifest = {
            "templateId": template_id,
            "source": "Photographs cropped from the paper PDF. Charts, maps and interface screenshots are not included.",
            "images": rels,
            "notes": {
                "scenes": "Photographs cropped from the paper, used as the survey stimuli.",
            },
        }
        (dest / "images.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    elif (dest / "images.json").exists():
        (dest / "images.json").unlink()

    path = TEMPLATE_DIR / f"{template_id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    stimulus_folder = STIMULUS_FOLDER[template_id]
    stimulus_n = len(stimuli)
    sample_folder = stimulus_folder if stimulus_n and stimulus_folder else None

    # Keep only folders this template can actually fill. "clips" stays so the
    # video question still has somewhere to point.
    folders = []
    if "clips" in (data.get("imageDatasetConfig", {}).get("mediaFolders") or []):
        folders.append("clips")
    if sample_folder and sample_folder not in folders:
        folders.append(sample_folder)
    data.setdefault("imageDatasetConfig", {})
    data["imageDatasetConfig"]["mediaFolders"] = folders
    data["description"] = patch_description(data.get("description") or "", stimulus_n, template_id)

    if sample_folder and stimulus_folder is not None:
        def tag(el):
            if el.get("type") in IMAGE_QUESTION_TYPES and el.get("mediaType") != "video":
                # Keep an existing narrower folder (Nasar already points at map).
                current = el.get("mediaFolders") or []
                if current and sample_folder in current:
                    return
                if current and stimulus_n:
                    return
                el["mediaFolders"] = [sample_folder]
        for page in data["config"]["pages"]:
            walk_elements(page.get("elements"), tag)

    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    review = os.environ.get("REVIEW_DIR")
    apply = os.environ.get("APPLY") == "1"
    for template_id in STIMULUS_FOLDER:
        path = TEMPLATE_DIR / f"{template_id}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        if has_library(template_id, data):
            print(f"skip library {template_id}")
            continue
        pdf = PDF_DIR / f"{template_id}.pdf"
        if not pdf.exists():
            print(f"missing pdf {template_id}")
            continue
        items = extract_template(template_id)
        stim = sum(1 for it in items if it["kind"] == "stimulus")
        fig = sum(1 for it in items if it["kind"] == "figure")
        print(f"{template_id}: {stim} scenes, {fig} figures")
        if review:
            contact_sheet(items, Path(review) / f"{template_id}.jpg")
        if apply:
            apply_template(template_id, items)


if __name__ == "__main__":
    main()
