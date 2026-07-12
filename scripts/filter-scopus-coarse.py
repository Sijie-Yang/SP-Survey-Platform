#!/usr/bin/env python3
"""
Scopus coarse filter → library shortlist (v6).

Usage:
  python3 scripts/filter-scopus-coarse.py \\
    --csv research/scopus/exports/2026-07-12.csv \\
    --out research/scopus/shortlists/2026-07-12_library_coarse.json \\
    --also public/research/scopus-shortlist.json
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

FILTER_VERSION = "v6"

# ── Must 1: urban imagery / street visual methods ─────────────────────────────
URBAN_IMAGE = re.compile(
    r"streetscapes?|street views?|street-view|street-level|\bgsv\b|\bsvi\b|"
    r"baidu street|tencent street|street imagery|"
    r"window views?|window-view|townscapes?|urban scenes?|urban images?|urban imagery|visual street|"
    r"(?:sidewalk\w*.{0,40}(?:image|photo|view)|(?:facades?|façades?).{0,40}(?:image|photo|visual)|"
    r"eye-level.{0,40}(?:image|photo|green)|green view|public space.{0,40}(?:image|photo|view))|"
    # v6: street space / activity + vision-language / CV street methods
    r"\bstreet spaces?\b|\bstreet activit\w*|\bstreet multi-activity\b|"
    r"(?:\bstreetscapes?\b|\bstreet spaces?\b|\bstreets?\b).{0,100}"
    r"(?:computer vision|multimodal|mllms?|large language models?|street[- ]view|imagery)|"
    r"(?:computer vision|multimodal|mllms?|large language models?).{0,100}"
    r"(?:\bstreetscapes?\b|\bstreet spaces?\b|\bstreet activit)",
    re.I,
)

# Classic questionnaire / survey (v5)
SURVEY = re.compile(
    r"\bsurveys?\b|questionnaires?|"
    r"crowdsourc\w*.{0,40}(?:survey|rating|perception|human)|"
    r"visual preference survey|photo elicitation|"
    r"participants?\s+\w+(?:\s+\w+){0,3}\s+(?:asked|rated|compared|evaluated|recruited)|"
    r"\brespondents?\b|\blikert\b|pairwise comparisons?|paired comparisons?|stated preference|"
    r"choice experiments?|human ratings?|subjective ratings?",
    re.I,
)

# v6: human perception / pedestrian activity evaluation (broader than survey)
HUMAN_ASSESS = re.compile(
    SURVEY.pattern
    + r"|"
    r"(?:human|subjective|visual)\s+perceptions?|"
    r"perceived (?:safety|quality|walkab\w*|beaut\w*|comfort)|"
    r"visual (?:assessment|preference|quality|evaluation)|"
    r"pedestrian activit\w*|"
    r"evaluat\w+ (?:the )?(?:street multi-activity|street spaces?|street activit\w*|multi-activity potential)|"
    r"(?:multi-activity potential|street multi-activity).{0,80}evaluat",
    re.I,
)

HARD_EXCLUDE = re.compile(
    r"autonomous driving|object detection|semantic segmentation|traffic flow prediction|crash prediction|"
    r"building energy|homelessness|clinical trial|epidemiolog|covid-19 vaccine|pavement distress|"
    r"image inpainting",
    re.I,
)

URBAN_PERCEPTION_TERMS = [
    "streetscape", "street view", "urban perception", "visual preference",
    "perceived safety", "walkability", "place pulse", "thermal comfort",
    "aesthetics", "beauty", "greenness", "urban design", "visual assessment",
    "image rating", "pairwise comparison", "crowdsourc", "human perception",
]

# Manual seeds not reliably produced by CSV+rules (or kept as regression markers)
FORCE_SEED_DOIS = {
    "10.1038/s44284-025-00330-x",  # SPECS — often absent from Scopus export
}


def normalize_doi(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s, flags=re.I)
    s = re.sub(r"^doi:\s*", "", s, flags=re.I)
    s = s.lower().strip().rstrip("/")
    return s or None


def paper_text(row: dict) -> str:
    return " ".join(
        [
            row.get("Title") or "",
            row.get("Abstract") or "",
            row.get("Author Keywords") or "",
            row.get("Index Keywords") or "",
        ]
    )


def passes_coarse(text: str) -> bool:
    if len(text) < 60:
        return False
    urban = bool(URBAN_IMAGE.search(text))
    human = bool(HUMAN_ASSESS.search(text))
    if not (urban and human):
        return False
    # Hard-exclude noise unless classic survey wording is present
    if HARD_EXCLUDE.search(text) and not SURVEY.search(text):
        return False
    return True


def parse_authors(raw: str) -> list[str]:
    out = []
    for part in re.split(r";\s*", raw or ""):
        part = part.strip()
        if not part:
            continue
        if "," in part:
            last, first = [x.strip() for x in part.split(",", 1)]
            initial = f"{first[0]}." if first else ""
            out.append(f"{last} {initial}".strip())
        else:
            out.append(part)
    return out


def parse_keywords(*fields: str) -> list[str]:
    seen = set()
    out = []
    for field in fields:
        for k in re.split(r";\s*", field or ""):
            k = k.strip()
            if not k:
                continue
            key = k.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(k)
    return out


def score_relevance(title, abstract, venue, keywords) -> float:
    blob = f"{title or ''} {abstract or ''} {venue or ''} {' '.join(keywords or [])}".lower()
    score = 0.0
    for term in URBAN_PERCEPTION_TERMS:
        if term.lower() in blob:
            score += 1
    if re.search(r"\b(survey|questionnaire|likert|rating|ranking|pairwise)\b", blob):
        score += 1.5
    if re.search(r"\b(image|photo|street view|gsv)\b", blob):
        score += 1
    return round(score, 1)


def infer_template_fit(title, abstract, relevance_score) -> str:
    blob = f"{title or ''} {abstract or ''}".lower()
    if not abstract:
        return "unknown"
    has_method = bool(
        re.search(
            r"\b(survey|questionnaire|participants|respondents|rating|ranking|pairwise|likert)\b",
            blob,
        )
    )
    has_visual = bool(re.search(r"\b(image|photo|street view|streetscape|visual)\b", blob))
    if relevance_score >= 3 and has_method and has_visual:
        return "likely"
    if relevance_score < 1.5:
        return "unlikely"
    return "unknown"


def row_to_paper(row: dict) -> dict | None:
    title = (row.get("Title") or "").strip()
    if not title:
        return None
    doi = normalize_doi(row.get("DOI"))
    abstract = row.get("Abstract") or ""
    venue = row.get("Source title") or ""
    keywords = parse_keywords(row.get("Author Keywords") or "", row.get("Index Keywords") or "")
    try:
        year = int(row.get("Year")) if row.get("Year") else None
    except ValueError:
        year = None
    cited = row.get("Cited by") or ""
    try:
        cited_by = int(cited) if str(cited).isdigit() else 0
    except ValueError:
        cited_by = 0
    score = score_relevance(title, abstract, venue, keywords)
    return {
        "doi": doi,
        "title": title,
        "authors": parse_authors(row.get("Authors") or ""),
        "year": year,
        "abstract": abstract,
        "venue": venue,
        "paper_url": f"https://doi.org/{doi}" if doi else (row.get("Link") or None),
        "crossref_doi": doi,
        "keywords": keywords[:30],
        "relevance_score": score,
        "template_fit": infer_template_fit(title, abstract, score),
        "status": "approved",
        "sources": ["scopus"],
        "raw_meta": {
            "import": f"coarse_{FILTER_VERSION}",
            "template_score": int(score) if score == int(score) else score,
            "cited_by": cited_by,
            "rule": "urban_image AND (survey OR human_assess) v6",
        },
    }


def load_seed_overrides(prev_paths: list[Path]) -> dict[str, dict]:
    """Pull force-seed papers from previous shortlists when not in CSV."""
    found: dict[str, dict] = {}
    for path in prev_paths:
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for p in data.get("papers") or []:
            doi = normalize_doi(p.get("doi"))
            if doi and doi in FORCE_SEED_DOIS:
                seed = dict(p)
                seed["sources"] = list(
                    dict.fromkeys([*(seed.get("sources") or []), "manual_seed"])
                )
                raw = dict(seed.get("raw_meta") or {})
                raw["import"] = "manual_seed"
                seed["raw_meta"] = raw
                seed["status"] = "approved"
                found[doi] = seed
    return found


def dedupe_key(paper: dict) -> str:
    doi = normalize_doi(paper.get("doi"))
    if doi:
        return f"doi:{doi}"
    title = re.sub(r"\s+", " ", (paper.get("title") or "").lower()).strip()
    return f"title:{title}|{paper.get('year') or ''}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--also", action="append", default=[])
    ap.add_argument(
        "--prev",
        action="append",
        default=[],
        help="Previous shortlist JSON(s) used to recover manual seeds",
    )
    args = ap.parse_args()

    csv_path = Path(args.csv)
    out_path = Path(args.out)
    also = [Path(p) for p in args.also]
    prev_paths = [Path(p) for p in args.prev] or [
        Path("research/scopus/shortlists/2026-07-12_library_coarse.json"),
        Path("public/research/scopus-shortlist.json"),
    ]

    kept: list[dict] = []
    seen: set[str] = set()
    scanned = 0
    for row in csv.DictReader(csv_path.open(newline="", encoding="utf-8-sig")):
        scanned += 1
        text = paper_text(row)
        if not passes_coarse(text):
            continue
        paper = row_to_paper(row)
        if not paper:
            continue
        key = dedupe_key(paper)
        if key in seen:
            continue
        seen.add(key)
        kept.append(paper)

    # Force seeds
    seeds = load_seed_overrides(prev_paths)
    # Minimal SPECS fallback if previous shortlist missing
    if "10.1038/s44284-025-00330-x" not in seeds:
        seeds["10.1038/s44284-025-00330-x"] = {
            "doi": "10.1038/s44284-025-00330-x",
            "title": "Global urban visual perception varies across demographics and personalities",
            "authors": [
                "Quintana M.", "Gu Y.", "Liang X.", "Hou Y.", "Ito K.",
                "Zhu Y.", "Abdelrahman M.", "Biljecki F.",
            ],
            "year": 2025,
            "abstract": (
                "We conducted a largescale urban visual perception survey of streetscapes "
                "worldwide using street view imagery, among 1,000 participants. Dataset SPECS; "
                "six traditional indicators and four new ones."
            ),
            "venue": "Nature Cities",
            "paper_url": "https://doi.org/10.1038/s44284-025-00330-x",
            "crossref_doi": "10.1038/s44284-025-00330-x",
            "keywords": ["SPECS", "street view", "survey"],
            "relevance_score": 12,
            "template_fit": "likely",
            "status": "approved",
            "sources": ["manual_seed", "arxiv:2505.12758"],
            "raw_meta": {"import": "manual_seed", "arxiv": "2505.12758"},
        }

    forced = 0
    for doi, seed in seeds.items():
        key = f"doi:{doi}"
        if key in seen:
            continue
        seen.add(key)
        kept.append(seed)
        forced += 1

    fit_counts = {"unknown": 0, "likely": 0, "unlikely": 0}
    for p in kept:
        fit_counts[p.get("template_fit") or "unknown"] = (
            fit_counts.get(p.get("template_fit") or "unknown", 0) + 1
        )

    payload = {
        "source": csv_path.name,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "policy": "urban imagery/street-vision AND (survey OR human perception/activity assess) v6",
        "filter_version": FILTER_VERSION,
        "count": len(kept),
        "fit_counts": fit_counts,
        "stats": {
            "csv_rows_scanned": scanned,
            "kept_from_csv": len(kept) - forced,
            "forced_seeds": forced,
        },
        "papers": kept,
    }

    def write(path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {path} ({payload['count']} papers)")

    write(out_path)
    for path in also:
        write(path)

    smap = "10.1016/j.compenvurbsys.2025.102350"
    print("SMAP included:", any(normalize_doi(p.get("doi")) == smap for p in kept))
    print("fit_counts:", fit_counts)


if __name__ == "__main__":
    main()
