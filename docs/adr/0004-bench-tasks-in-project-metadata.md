# 0004. SP-Bench human tasks are frozen aggregates in project metadata

- Status: Accepted
- Date: 2026-10-22

## Context

The SP-Bench human-agreement track scores models against what people answered on real platform studies. It needs a public list of tasks, but participant-level data must not become public, and the task must not change under a submitted score when new responses arrive.

## Decision

The project owner publishes a question from Results. The platform stores a frozen per-image aggregate (TrueSkill μ or mean rating, counts, schema `sp-bench-human-task/1`) in `projects.metadata.spBenchTasks`. `GET /api/bench/human/tasks` lists them. Scoring (Kendall τ-b / Spearman ρ, overall = mean over tasks, missing = 0) runs in `src/lib/benchHumanTrack.js` in the browser and in CI. Submissions are JSON files added by pull request to `public/bench/submissions/`.

## Consequences

- No new table or SQL; only aggregates leave the project.
- Republishing a task is an explicit owner action and changes its `frozen_at`.
- Leaderboard entries are reviewable diffs, so anyone can recompute a score.
