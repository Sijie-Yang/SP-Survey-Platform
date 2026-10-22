# Changelog

Notable changes for researchers using SP-Survey. Versions follow [docs/RELEASING.md](docs/RELEASING.md); a change in how numbers are computed is always listed under **Changed results**.

## Unreleased

### Added
- Citable dataset package export (README, LICENSE, CITATION.cff, datapackage.json, stimuli manifest; identifiers stripped by default).
- Journal-style figures (SVG/PNG) per question and an "All figures" ZIP.
- Silicon-vs-human agreement report on Results and in the analysis pack, with a linear calibration of silicon scores onto the human scale (slope, intercept, R², leave-one-out error; `silicon_calibration.csv`).
- Citation loop: **Cite** button, `references.bib` + `CITATION.cff` in every export, SP-Report v1 checklist, `/publications` page.
- SP-Bench human-agreement track: publish image questions as public tasks, score model predictions in the browser, submit by pull request.
- Python SDK `spsurvey` (`sdk/python`) wrapping the MCP tools; read-only MCP tools for silicon runs; `dataset_package` export format.
- Phone-preview QR code in Builder; optional "Made with SP-Survey" footer on participant pages.
- Forgot-password and resend-confirmation on the login page; 404 page.
- Image-version contrasts for counterfactual designs: when files are named `scene__version.jpg` or versions sit in folders, Results shows each version's mean per-scene difference from a baseline (95% CI, paired t, Holm-adjusted p, Cohen's d_z); the analysis pack adds `variant_contrasts.csv` and `variant_pairs.csv`.
- Qualtrics import: the project sidebar's import button accepts a `.qsf` file and creates a project (multiple choice, matrix, slider, text entry, rank order, constant sum, descriptive text); a report lists what was not converted (display logic, randomizers, unsupported types).
- Methods drafts in journal house style (Environment and Planning B, CEUS, Landscape and Urban Planning): **Cite → Methods for a journal** on Results, and `methods_for_journals/*.md` in the analysis pack. Fixed templates, no model; placeholders for recruitment and ethics.
- SP-Forum at `/forum`: categories, search, open/closed threads, replies, edit and delete own posts; authors close and reopen their threads; admins pin, hide and post announcements. Posts show a display name, never the e-mail; outside images are shown as links.
- Governance: CONTRIBUTING, RELEASING, architecture decision records, template contribution guide, issue and PR templates.

### Changed results
- None.

### SQL to run
- `supabase/forum.sql` (SP-Forum). Until it is run, `/forum` says the forum is not switched on yet.

## 0.1.0

First public version of the hosted platform (sp-survey.org).
