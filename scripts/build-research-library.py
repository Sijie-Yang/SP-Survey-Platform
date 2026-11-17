#!/usr/bin/env python3
"""Build the canonical paper library (public/research/library.json).

The library file is the single source of truth for the online paper library,
in the same way public/project_templates/ is for templates:

  Scopus export ──research:filter──▶ v6 shortlist (rule-based candidates)
  research/library/overrides.json   (papers kept or dropped by hand, with reasons)
  public/project_templates/*.json   (each paper template's "doi")
                 └──research:library──▶ public/research/library.json
                                         └─ Admin → 论文库 → 从文件同步 ▶ research_papers

Every paper records why it is in the library (`inclusion.via`), and paper
templates are linked through their DOI (`template_id`). A template whose paper
cannot be found or built stops the build, so templates and papers cannot drift.

Usage:
  python3 scripts/build-research-library.py            # defaults below
  python3 scripts/build-research-library.py --check    # validate only, write nothing
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY_FORMAT = "sp-survey-paper-library"
LIBRARY_FORMAT_VERSION = 1
VIA_ORDER = ["scopus_v6", "manual_seed", "template", "legacy_import", "admin_added", "manual"]


def load_filter_module():
    """Reuse row_to_paper / normalize_doi from the Scopus filter (file name has hyphens)."""
    spec = importlib.util.spec_from_file_location(
        "filter_scopus_coarse", ROOT / "scripts" / "filter-scopus-coarse.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


FILTER = load_filter_module()
normalize_doi = FILTER.normalize_doi


def title_key(title: str | None, year) -> str:
    t = re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()
    return f"title:{t}|{year or ''}"


def paper_key(paper: dict) -> str:
    doi = normalize_doi(paper.get("doi"))
    return f"doi:{doi}" if doi else title_key(paper.get("title"), paper.get("year"))


def entry_key(entry: dict) -> str:
    doi = normalize_doi(entry.get("doi"))
    if doi:
        return f"doi:{doi}"
    paper = entry.get("paper") or {}
    return title_key(entry.get("title") or paper.get("title"), entry.get("year") or paper.get("year"))


def manual_paper(entry: dict, via: str) -> dict:
    """Build a library row from metadata stored in overrides.json."""
    meta = dict(entry.get("paper") or {})
    if not meta.get("title"):
        raise ValueError(f"override {entry_key(entry)} needs paper.title (not in the Scopus export)")
    doi = normalize_doi(entry.get("doi") or meta.get("doi"))
    return {
        "doi": doi,
        "title": meta["title"],
        "authors": meta.get("authors") or [],
        "year": meta.get("year"),
        "abstract": meta.get("abstract") or "",
        "venue": meta.get("venue") or "",
        "paper_url": meta.get("paper_url") or (f"https://doi.org/{doi}" if doi else None),
        "crossref_doi": doi,
        "keywords": meta.get("keywords") or [],
        "relevance_score": meta.get("relevance_score") or 0,
        "template_fit": meta.get("template_fit") or ("likely" if via == "template" else "unknown"),
        "status": "approved",
        "sources": meta.get("sources") or ["manual"],
        "raw_meta": {"import": "library_override", **(meta.get("raw_meta") or {})},
    }


def load_templates(template_dir: Path) -> list[dict]:
    index = json.loads((template_dir / "index.json").read_text(encoding="utf-8"))
    out = []
    for name in index.get("templates") or []:
        tpl = json.loads((template_dir / str(name)).read_text(encoding="utf-8"))
        out.append({"id": tpl.get("id"), "doi": normalize_doi(tpl.get("doi")), "file": str(name)})
    return out


def build(args) -> tuple[dict, list[str]]:
    errors: list[str] = []
    shortlist = json.loads(Path(args.shortlist).read_text(encoding="utf-8"))
    overrides = json.loads(Path(args.overrides).read_text(encoding="utf-8"))
    csv_rows: dict[str, dict] = {}
    for row in csv.DictReader(Path(args.csv).open(newline="", encoding="utf-8-sig")):
        doi = normalize_doi(row.get("DOI"))
        if doi and doi not in csv_rows:
            csv_rows[doi] = row

    papers: dict[str, dict] = {}
    for p in shortlist.get("papers") or []:
        paper = dict(p)
        via = "manual_seed" if "manual_seed" in (paper.get("sources") or []) else "scopus_v6"
        paper["inclusion"] = {
            "via": via,
            "reason": "Scopus export, coarse filter "
            + str(shortlist.get("filter_version") or "")
            if via == "scopus_v6"
            else "research/scopus/seeds.md",
        }
        paper["status"] = "approved"
        paper.pop("template_id", None)
        papers[paper_key(paper)] = paper

    def add(entry: dict, via: str, reason: str, added: str | None = None) -> dict | None:
        key = entry_key(entry)
        if key in papers:
            return papers[key]
        doi = normalize_doi(entry.get("doi"))
        if doi and doi in csv_rows:
            paper = FILTER.row_to_paper(csv_rows[doi])
            if via == "template":
                paper["template_fit"] = "likely"
        else:
            try:
                paper = manual_paper(entry, via)
            except ValueError as err:
                errors.append(str(err))
                return None
        paper["status"] = "approved"
        paper["inclusion"] = {"via": via, "reason": reason, **({"added": added} if added else {})}
        papers[paper_key(paper)] = paper
        return paper

    # 1. Papers kept by hand (legacy imports, admin additions, template papers with metadata).
    for entry in overrides.get("include") or []:
        via = entry.get("via") or "manual"
        if via not in VIA_ORDER:
            errors.append(f"include {entry_key(entry)}: unknown via '{via}'")
            continue
        if not entry.get("reason"):
            errors.append(f"include {entry_key(entry)}: reason is required")
            continue
        if entry_key(entry) in papers:
            errors.append(
                f"include {entry_key(entry)} is already in the library "
                f"(via {papers[entry_key(entry)]['inclusion']['via']}); remove it from overrides.json"
            )
            continue
        add(entry, via, entry["reason"], entry.get("added"))

    # 2. Papers dropped by hand.
    excluded = []
    for entry in overrides.get("exclude") or []:
        key = entry_key(entry)
        if not entry.get("reason"):
            errors.append(f"exclude {key}: reason is required")
        if papers.pop(key, None) is None:
            errors.append(f"exclude {key}: not in the library")
        excluded.append(key)

    # 3. Template links from template files (DOI), plus links for templates without a file DOI.
    linked: dict[str, str] = {}

    def link(key: str, template_id: str, where: str) -> None:
        paper = papers.get(key)
        if paper is None:
            errors.append(f"{where}: paper {key} is not in the library")
            return
        prev = paper.get("template_id")
        if prev and prev != template_id:
            errors.append(f"{where}: paper {key} is already linked to {prev}")
            return
        if template_id in linked and linked[template_id] != key:
            errors.append(f"{where}: template {template_id} is linked to two papers")
            return
        paper["template_id"] = template_id
        paper["template_fit"] = "likely"
        linked[template_id] = key

    for tpl in load_templates(Path(args.templates)):
        if not tpl["doi"]:
            continue
        key = f"doi:{tpl['doi']}"
        if key not in papers:
            if key in excluded:
                errors.append(f"template {tpl['id']}: its paper {tpl['doi']} is excluded in overrides.json")
                continue
            if tpl["doi"] in csv_rows:
                add({"doi": tpl["doi"]}, "template", f"Paper of template {tpl['id']}")
            else:
                errors.append(
                    f"template {tpl['id']}: paper {tpl['doi']} is not in the library or the Scopus export; "
                    "add it to overrides.json include with via 'template' and paper metadata"
                )
                continue
        link(key, tpl["id"], f"template {tpl['id']}")

    for entry in overrides.get("template_links") or []:
        if not entry.get("template_id"):
            errors.append(f"template_links {entry_key(entry)}: template_id is required")
            continue
        link(entry_key(entry), entry["template_id"], f"template_links {entry['template_id']}")

    # Keep analysis_meta from the previous build for papers whose text did not change,
    # so a rebuild only re-extracts new or edited rows (see enrich --only-missing).
    prev_path = Path(args.out)
    if prev_path.exists():
        prev = {paper_key(p): p for p in json.loads(prev_path.read_text(encoding="utf-8")).get("papers") or []}
        for key, paper in papers.items():
            old = prev.get(key)
            if (
                old
                and old.get("analysis_meta")
                and not paper.get("analysis_meta")
                and old.get("title") == paper.get("title")
                and old.get("abstract") == paper.get("abstract")
            ):
                paper["analysis_meta"] = old["analysis_meta"]

    rows = sorted(
        papers.values(),
        key=lambda p: (-(p.get("year") or 0), (p.get("title") or "").lower()),
    )
    by_via: dict[str, int] = {}
    for p in rows:
        by_via[p["inclusion"]["via"]] = by_via.get(p["inclusion"]["via"], 0) + 1
    payload = {
        "format": LIBRARY_FORMAT,
        "format_version": LIBRARY_FORMAT_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": {
            "scopus_export": Path(args.csv).name,
            "filter_version": shortlist.get("filter_version"),
            "overrides": "research/library/overrides.json",
        },
        "count": len(rows),
        "counts_by_inclusion": {k: by_via[k] for k in VIA_ORDER if k in by_via},
        "template_links": len(linked),
        "excluded": len(excluded),
        "papers": rows,
    }
    return payload, errors


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shortlist", default=str(ROOT / "research/scopus/shortlists/2026-07-12_library_coarse.json"))
    ap.add_argument("--csv", default=str(ROOT / "research/scopus/exports/2026-07-12.csv"))
    ap.add_argument("--overrides", default=str(ROOT / "research/library/overrides.json"))
    ap.add_argument("--templates", default=str(ROOT / "public/project_templates"))
    ap.add_argument("--out", default=str(ROOT / "public/research/library.json"))
    ap.add_argument("--check", action="store_true", help="validate only; do not write")
    args = ap.parse_args()

    payload, errors = build(args)
    if errors:
        print("Library build failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    summary = f"{payload['count']} papers {payload['counts_by_inclusion']}, {payload['template_links']} template links"
    if args.check:
        print(f"OK: {summary}")
        return
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)}: {summary}")


if __name__ == "__main__":
    main()
