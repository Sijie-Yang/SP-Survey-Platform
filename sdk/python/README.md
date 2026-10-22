# spsurvey — Python SDK for SP-Survey

Build, run and analyse visual perception experiments on [sp-survey.org](https://sp-survey.org) from Python, a notebook, or an agent. Three lines create a pairwise-comparison study from a folder of photos; three more pull the results as a DataFrame and the citable dataset package.

```bash
pip install "spsurvey[pandas]"
spsurvey login            # opens the browser once; the token is stored in ~/.config/spsurvey/
```

```python
from spsurvey import Client, pairwise_survey

sp = Client()
project = sp.create_project("Street safety", survey_config=pairwise_survey("Street safety", "Which street looks safer?"))
sp.upload_images(project.id, "./my_streets")          # real photos you may show participants
print(sp.publish(project.id).live_url)                 # share this link

df = sp.responses_wide(project.id)                     # one row per submission
scores = sp.image_scores(project.id, "which_street_looks_safer")   # TrueSkill μ/σ per image
sp.download_dataset_package(project.id, "./release")   # README, LICENSE, CITATION.cff, datapackage.json, anonymised data
```

The SDK has no required dependencies. `pandas` is optional for DataFrames, `matplotlib` for the plotting example.

## What it wraps

Every method calls one tool of the platform's public MCP endpoint (`https://sp-survey.org/mcp`), the same tools Codex, Claude Code and Cursor use. Nothing is computed in the SDK that the platform does not compute itself, so a number here equals the number on the Results page.

| Client method | Platform tool |
| --- | --- |
| `list_projects`, `create_project`, `create_from_template`, `update_project`, `delete_project` | `survey_*_project` |
| `get_draft`, `replace_draft`, `apply_operations`, `validate`, `publish`, `versions`, `urls` | `survey_get_draft`, `survey_replace_draft`, `survey_apply_operations`, `survey_validate`, `survey_publish`, `survey_list_versions`, `survey_preview_urls` |
| `upload_image`, `upload_images`, `list_media` | `media_upload`, `media_list` |
| `responses`, `responses_wide`, `question_summary`, `image_scores`, `analysis_bundle`, `dataset_package` | `survey_export_responses` (`json`, `wide_csv`, `summary_csv`, `analysis_bundle`, `dataset_package`) |
| `results_summary` | `survey_results_summary` |
| `silicon_runs`, `silicon_responses` | `silicon_list_runs`, `silicon_run_responses` (read-only) |
| `capabilities` | `survey_capabilities` |

Result filters are keyword arguments: `data_source="human" | "practice" | "silicon"`, `silicon_run_id`, `include_practice`, `exclude_flagged`, `date_from`, `date_to`, `session_id`, `survey_revision`.

## Survey builders

`spsurvey.surveys` writes `surveyConfig` dicts deterministically:

- `pairwise_survey(title, question, trials=12, allow_tie=False, consent=True, demographics=False, intro_html="")`
- `rating_survey(title, question, trials=10, scale_min=1, scale_max=7, ...)`
- `survey(title, [pairwise_question(...), rating_question(...), slider_group_question(...)], ...)`

Images are drawn per participant from the project's media library (`upload_images`), so the config holds no URLs. For anything beyond these, read `Client().capabilities()` and write the config by hand or with `apply_operations`.

## Authentication

1. `spsurvey login` registers a loopback OAuth client, opens the approval page on sp-survey.org, and stores access + refresh tokens (PKCE, no secret). Expired tokens refresh automatically.
2. `SPSURVEY_TOKEN=...` overrides the stored token (CI, servers, agents). A Supabase session token or an MCP token from **Admin → Integrations** both work.
3. `SPSURVEY_BASE_URL` points the SDK at a self-hosted instance.

## Command line

```bash
spsurvey projects
spsurvey upload <project id> ./photos --into set_a
spsurvey publish <project id>
spsurvey url <project id>
spsurvey results <project id> --format dataset_package --out ./release
```

## Examples

- `examples/pairwise_from_folder.py` — folder of photos → pairwise survey → published link.
- `examples/fetch_and_plot.py` — pull a question's TrueSkill table and draw it.

## Tests

```bash
pip install "./sdk/python[test]"
python -m pytest -q sdk/python
```

Tests use a fake transport; nothing touches the network.

## Publishing to PyPI (maintainers)

```bash
cd sdk/python
python -m pip install build twine
python -m build
python -m twine upload dist/*
```

## Citing

If the data appear in a paper, cite SP-Survey. Every export carries `references.bib` and `CITATION.cff`; the Results page has a **Cite** button.
