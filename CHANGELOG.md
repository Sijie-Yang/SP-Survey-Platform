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
- Governance: CONTRIBUTING, RELEASING, architecture decision records, template contribution guide, issue and PR templates.

### Changed results
- None.

### SQL to run
- None.

## 0.1.0

First public version of the hosted platform (sp-survey.org).
