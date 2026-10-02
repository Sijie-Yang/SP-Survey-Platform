# sp_streetlevel — local street-level download helper

Runs on the researcher's own computer. It downloads views for a project's street-level
point list (picked in Platform → Media Dataset → Street-level imagery) and uploads the
finished JPEGs plus `features/street_level_v1.csv` through the Platform's normal
authenticated media upload. The Platform (Cloudflare Worker) never fetches tiles or images.

Imagery sources:

- **Google Street View** (default, no key) through [`streetlevel`](https://github.com/sk-zk/streetlevel).
- **Mapillary** (optional) through its official Graph API v4. Mapillary requires a free
  client access token on every call (mapillary.com/dashboard/developers). `streetlevel` has no
  Mapillary provider; this helper calls the API directly.

## Terms — read this first

`streetlevel` reads Google Street View through the **unofficial endpoints used by Google's own
viewer** (not the Google Maps Platform API). Google's terms forbid downloading, caching and
storing Street View imagery, and the restriction applies to academic and non-commercial projects
too. Using the Google source conflicts with those terms. It runs under your account and from your
network; you are responsible for that choice. The Platform does not claim it is compliant.

Mapillary images are CC BY-SA 4.0. The contributor, licence and a link are stored with every file;
keep that attribution when you publish them.

## Install (once) — Python 3.9+ (plus two Homebrew libraries on macOS)

macOS only — do this **before** the pip command:

```bash
brew install gettext && brew install inih
```

Why: `streetlevel` depends on `pyexiv2`, whose bundled `libexiv2.dylib` on macOS is linked against
Homebrew's `gettext` and `inih`. Without them pip still succeeds, but the helper stops at start with
`OSError: dlopen(...libexiv2.dylib): Library not loaded: /opt/homebrew/opt/inih/lib/libINIReader.0.dylib`
(this is the setup step from the streetlevel README). It applies to every macOS Python, including
Anaconda and python.org builds. No Homebrew? Install it from https://brew.sh. Windows and Linux do
not need this step. If the libraries are missing, `python3 -m sp_streetlevel serve` prints this fix.

macOS / Linux:

```bash
python3 -m pip install --user "https://github.com/Sijie-Yang/SP-Survey-Platform/archive/refs/heads/main.zip#subdirectory=tools/streetlevel-helper"
```

Windows:

```bat
py -m pip install --user "https://github.com/Sijie-Yang/SP-Survey-Platform/archive/refs/heads/main.zip#subdirectory=tools/streetlevel-helper"
```

No pipx, git or PATH changes are needed; everything runs through `python -m`.
If pip refuses with `externally-managed-environment` (Homebrew Python, Debian/Ubuntu system Python),
use a private environment instead:

```bash
python3 -m venv ~/.sp-streetlevel && ~/.sp-streetlevel/bin/python -m pip install "https://github.com/Sijie-Yang/SP-Survey-Platform/archive/refs/heads/main.zip#subdirectory=tools/streetlevel-helper"
~/.sp-streetlevel/bin/python -m sp_streetlevel serve
```

No Python? Get it from https://www.python.org/downloads/ (on a Mac, `brew install python` also works).

## Main path: the Download button

```bash
python3 -m sp_streetlevel serve      # Windows: py -m sp_streetlevel serve
```

Keep it running. The Street-level panel detects it on `http://127.0.0.1:47821`; its **Download**
button sends the point list, the batch settings and your signed-in session, and shows per-point
progress, failures and resume. The helper binds to 127.0.0.1 only and accepts browser calls only
from `https://sp-survey.org` and `http://localhost:3000` (add others with `--allow-origin https://your-host`).

## Fallback: one command

```bash
python3 -m sp_streetlevel run --project <project-id> --preset current
```

Signs in through the browser the first time (OAuth; token cached in
`~/.config/sp-survey/streetlevel-credentials.json`, mode 600), loads the saved point list, downloads,
uploads and registers the files. Re-run the same command to resume. For Mapillary add
`--source mapillary` and set `MAPILLARY_TOKEN` in the environment first.

## Batch view settings

One batch setting covers every point. Points that came from a pasted Street View URL (or that were
edited in the panel) keep their own heading / pitch / FOV instead.

| Option | Meaning |
|---|---|
| `--preset current` | one view per point |
| `--preset road` | front / right / back / left relative to the road |
| `--preset headings --heading-count N` | N evenly spaced headings |
| `--preset pano` | the stitched equirectangular panorama |
| `--heading-mode road` (default) / `fixed --fixed-heading 45` | batch heading: drawn road bearing or nearest pano link, or a fixed compass heading |
| `--pitch`, `--fov`, `--width` | batch pitch, field of view and output width |
| `--source google` (default) / `mapillary` | imagery source |
| `--zoom 0-5` | Google panorama resolution (3 ≈ 4096 px wide) |
| `--radius` | search radius in metres (Mapillary ≤ 50) |
| `--folder`, `--folder-mode single\|category\|set-per-point` | media-library folder and set/category tagging |
| `--min-interval` | seconds between upstream requests (default 1.5); requests are sequential |

Mapillary panoramas are re-projected like Google ones; regular Mapillary photos are saved as-is
(`mly-{id}-orig.jpg`). File names are deterministic, so files already in the media library are skipped.

## Tests

```bash
python3 -m pip install -e ".[test]" && python3 -m pytest
```

Tests run the real `streetlevel` parsing and tile stitching against a local stub (recorded lookup
responses and synthetic tiles), a local Mapillary Graph API stub and a fake Platform upload API;
they never contact Google or Mapillary.
