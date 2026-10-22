# Contributing a research template

A template turns a published perception study into a survey anyone can start from in one click. Good templates are the platform's most-cited feature, so they follow the paper closely and say plainly where they don't.

## What a template is

```
public/project_templates/
  index.json                      # list of template files shown in the gallery
  2014-naik-streetscore.json      # the template
  2014-naik-streetscore/          # optional: stimuli you may redistribute
    images.json
    p02-01.jpg ...
```

The template id is `<year>-<first author surname>-<first content word of the title>` in lower case, e.g. `2014-naik-streetscore`.

## Required fields

| Field | Content |
| --- | --- |
| `id` | Same as the file name. |
| `name` | Short study name, then what participants do ("Streetscore – Place Pulse Safety Comparison"). |
| `description` | 2–4 sentences: the task, the scale, and **every deviation from the paper** (extra pages, fewer images, changed wording). |
| `author`, `year` | As cited. |
| `category` | `Academic Research` for paper templates. |
| `tags` | Include `reference`. |
| `website` | Project or paper page. |
| `config` | A SurveyJS config that passes `validateSurveyConfig`. Question `name`s are unique snake_case. |
| `config.spAnalysisRecommendation` | `{ citation, items: [{ questions: [...], method, ... }] }` naming the analysis the paper used. |

`method` is one the Results page implements: `trueskill_pairwise`, `qscore_pairwise`, `choice_share`, `scalar_distribution`, `robust_median`, `slider_dimensions`, `matrix_rows`, `rater_agreement`, `param_aggregation`, `geographic_evaluative_map`, `long_export`. If the paper used something else, pick the closest and say so in `description`; propose the new method in a separate PR.

Also add:

1. The id to `index.json`.
2. The full reference and DOI to `src/pages/paperTemplateCitations.js`.
3. An entry to `PAPER_TEMPLATE_DOCS` in `src/pages/paperTemplateDocs.js` (gallery order is by year).
4. The id to `PAPER_TEMPLATES` in `src/lib/paperTemplates.test.js`, which checks that the config validates and that every recommended question exists.

## Stimuli

Only include images you are allowed to redistribute:

- photographs printed in an open-access paper (crop them from the PDF; leave out charts, maps and screenshots),
- images released by the authors under an open licence, or
- your own photographs, released under CC BY 4.0.

**Never** add AI-generated or "placeholder" images ([ADR 0006](adr/0006-real-stimuli-only.md)). If no images can be redistributed, ship the template without a folder; researchers then upload their own.

`images.json` records where the files came from:

```json
{
  "templateId": "2014-naik-streetscore",
  "source": "Photographs cropped from the paper PDF. Charts, maps and interface screenshots are not included.",
  "images": ["p02-01.jpg", "p02-02.jpg"],
  "notes": { "scenes": "Photographs cropped from the paper, used as the survey stimuli." }
}
```

Keep images under 300 KB each (JPEG, long side ≤ 1600 px) and say in `description` how many the template bundles compared with the original study.

## Fidelity checklist (put it in the PR body)

- [ ] Question wording copied from the paper (quote and page number in the PR).
- [ ] Scale endpoints and number of points match.
- [ ] Trial count, randomisation and tie handling match, or the deviation is in `description`.
- [ ] Analysis method and minimum responses per image (`minPerImage`) follow the paper.
- [ ] Image source and licence recorded in `images.json`.
- [ ] `CI=true npx react-scripts test src/lib/paperTemplates.test.js --watchAll=false` passes.

## Non-paper templates

Teaching demos and method templates (for example a counterfactual before/after design) are welcome too. Use `category: "Method"` or `"Teaching"`, skip the citation files, and keep the same stimulus rules.
