# SP-Bench human-agreement submissions

Each file here is one leaderboard entry for the **Human agreement** track on
https://sp-survey.org/bench. The page recomputes every score from these files
against the current public tasks, so a file holds predictions, not scores.

## Add your model

1. Open https://sp-survey.org/bench, download the task CSV templates, and fill
   the `value` column with your model's score for each image (higher = more of
   the quality the question asks about).
2. Upload the CSV on the same page to see your score, then press
   **Download submission file**.
3. Open a pull request that adds the file to this folder and its name to
   `index.json`.

## File format (`sp-bench-human-submission/1`)

```json
{
  "schema": "sp-bench-human-submission/1",
  "model": "My VLM 2",
  "organisation": "Example Lab",
  "contact": "",
  "url": "https://example.org/paper",
  "kind": "model",
  "date": "2026-10-22",
  "notes": "",
  "predictions": {
    "<task_id>": { "<item_key>": 0.73, "<item_key>": 0.12 }
  }
}
```

`kind` is `model` or `silicon` (an SP-Survey silicon-sample run). Items can be
keyed by `item_key`, image URL or file name. A test checks that every file in
this folder is listed in `index.json` and is valid.
