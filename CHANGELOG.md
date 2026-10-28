# Changelog

Notable changes for researchers using SP-Survey. Versions follow [docs/RELEASING.md](docs/RELEASING.md); a change in how numbers are computed is always listed under **Changed results**.

## Unreleased

### Changed
- Licence: source code is now under MIT; documentation, survey templates and research data stay under CC BY 4.0.

### Added
- Results: a custom question (an SP-Scheme page's own task that mixes several answer types in one record, e.g. two ratings, two reason lists and an A/B choice per round) is now analysed by the platform itself, field by field, before any model: image fields, the choice between the images (TrueSkill; "similar" counted, not ranked), scores tied to their image, multi-select tags (counts and the mean score when each tag was picked), choice-vs-score consistency, time per trial, free text, and a split by group (a field fixed per participant or another question such as grade). A list at the top says which fields were analysed and which were skipped and why. "生成分析" becomes "让模型补充": the model is told what is done and only adds the parts the platform could not read.
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
