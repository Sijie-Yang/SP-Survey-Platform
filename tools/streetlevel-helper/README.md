# sp-streetlevel — local street-level download helper

Runs on the researcher's own computer. It reads a project's street-level point list
(picked in Platform → Media Dataset → Street-level imagery), downloads the views with
[`streetlevel`](https://github.com/sk-zk/streetlevel), and uploads the finished JPEGs plus
`features/street_level_v1.csv` through the Platform's normal authenticated media upload.
The Platform (Cloudflare Worker) never fetches tiles or panoramas.

## Terms — read this first

`streetlevel` reads Google Street View through the **unofficial endpoints used by Google's
own viewer** (not the Google Maps Platform API). Google's terms forbid downloading, caching
and storing Street View imagery, and the restriction applies to academic and non-commercial
projects too. Using this helper conflicts with those terms. It runs under your account and
from your network; you are responsible for that choice. The Platform does not claim this is
compliant.

## Install (once)

```bash
pipx install "git+https://github.com/Sijie-Yang/SP-Survey-Platform@main#subdirectory=tools/streetlevel-helper"
```

(`pip install` into a virtualenv works too. Python 3.9+.)

## Main path: the Download button

```bash
sp-streetlevel serve
```

Keep it running. The Street-level panel detects it on `http://127.0.0.1:47821` and its
**Download** button sends the point list, preset and your signed-in session; progress,
failures and resume are shown in the panel. The helper binds to 127.0.0.1 only and accepts
browser calls only from `https://sp-survey.org` and `http://localhost:3000` (add others with
`--allow-origin https://your-host`).

## Fallback: one command

```bash
sp-streetlevel run --project <project-id> --preset current
```

Signs in through the browser the first time (OAuth, token cached in
`~/.config/sp-survey/streetlevel-credentials.json`, mode 600), loads the saved point list,
downloads, uploads and registers the files in the project's media library. Re-run the same
command to resume. `--api http://localhost:3001` targets a local Platform.

## Options

| Option | Meaning |
|---|---|
| `--preset current` | the point's heading / pitch / FOV (from a pasted Street View URL), else facing the point |
| `--preset pano` | the stitched equirectangular panorama |
| `--preset headings --heading-count N` | N evenly spaced headings starting at the point heading |
| `--preset road` | front / right / back / left relative to the road (drawn road bearing or nearest pano link) |
| `--zoom 0-5` | panorama resolution (3 ≈ 4096 px wide, default) |
| `--width`, `--pitch`, `--fov` | view size and defaults for points without them |
| `--folder`, `--folder-mode single\|category\|set-per-point` | media library folder and set/category tagging |
| `--min-interval` | seconds between upstream requests (default 1.5); requests are sequential |

A point with a pano id (from a pasted URL) is looked up by id; otherwise the nearest pano
within `--radius` metres is used. File names are deterministic
(`gsv-{panoId}-h{heading}-{p|m}{pitch}-f{fov}.jpg`, `gsv-{panoId}-pano.jpg`), so files that
are already in the media library are skipped on resume.

## Tests

```bash
pip install -e ".[test]" && pytest
```

Tests run the real `streetlevel` parsing and tile stitching against a local stub (recorded
lookup responses and synthetic tiles) and a fake Platform upload API; they never contact Google.
