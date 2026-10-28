# Changelog

Notable changes for researchers using SP-Survey. Versions follow [docs/RELEASING.md](docs/RELEASING.md); a change in how numbers are computed is always listed under **Changed results**.

## Unreleased

### Changed
- Licence: source code is now under MIT; documentation, survey templates and research data stay under CC BY 4.0.

### Added
- Results: "生成分析" for a custom question (an SP-Scheme page's own task that mixes several answer types in one record, e.g. two ratings, two reason lists and an A/B choice per round) now works in two steps. The Assistant model reads the question, the page code and every stored field and writes an analysis plan: what each field means in the survey's own words, which image it belongs to and how to analyse it (score, choice between images, option, tags, group, duration, text, skip, or custom code). The platform checks that the plan covers every field (missing ones are sent back once), then computes the results from the plan with its own algorithms, so the same records and plan always give the same numbers: per-image scores or an image × item table, TrueSkill ranking of the chosen images with option counts and a choice-vs-rating consistency check, tag counts with the mean score of the image each tag described, durations in seconds (cumulative timing flagged), free text, and one background table of participant attributes (age, gender, grade, AB order: counts or mean, each listed once even when the page stored it twice); a split by group only for attributes the researcher's notes ask to compare by. Scores stored once per item field (scenes[].ratings.A1, .M1, …) form one image × item table; a second copy of the same scores is counted once; JSON saved as text is read through, never analysed as free text. The plan is shown first as a 字段 → 含义 → 分析 table with skipped fields behind a toggle; charts and tables are titled by the plan's meanings. Model code is only asked for fields the plan marks as custom. Plan and code are saved together (`version: 2`); earlier code-only analyses still run. No SQL.
- SP-Scheme pages that draw their own images (`SPSite.getMedia('folder')` or an empty image list) now fall back to the platform preview media library when the project library is empty, on the live link and in Builder preview, as native questions already did (never for a published, release-managed version). Responses record `sp_site.preview_media_library`. The admin diagnosis says so and also counts questions whose images the platform draws per question.
- Admin 项目概览: projects that run an uploaded page are tagged (SP-Scheme page / imported as is / SP-Scheme questions, plus "draft not published"), with a filter and a diagnosis dialog (what participants are served, where the page's images come from, whether answers are recorded, latest responses). A download button rebuilds the upload as a ZIP: served `index.html`, embedded data files, the media the page can draw, settings, sample responses and a README with the checks.
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
- Custom-question exports gain `questions/{name}__ai__{n}_platform_{type}.csv` files computed by the platform (including `_coverage`), with or without a saved model analysis; a saved model analysis whose blocks repeat the platform's data is no longer shown or exported twice.

### SQL to run
- `supabase/forum.sql` (SP-Forum). Until it is run, `/forum` says the forum is not switched on yet.

## 0.1.0

First public version of the hosted platform (sp-survey.org).
