# Scheduled jobs

Every recurring job that touches sp-survey.org data is listed here. Add a row
when you add a job, and remove it when you turn one off. Keep the list short.

| Job | When | Runs on | What it does | Writes | How to turn it off |
| --- | --- | --- | --- | --- | --- |
| Weekly paper scan | Monday 01:00 UTC (9 AM Singapore) | Cloudflare Worker cron (`wrangler.jsonc` → `triggers.crons`, `scheduled()` in `worker.js`) | Searches Semantic Scholar + Crossref with the preset queries, in two passes: **recent** (last year and this year) and **backfill** (one older year, one year further back each week, stops at 2000). | New papers with a DOI, as `candidate` in `research_papers`; one row per pass in `research_paper_scans` (`preset` = `weekly` or `backfill`). Never changes existing papers, never publishes. | Remove the cron from `wrangler.jsonc`. |
| Weekly paper → template | Thursday 10:41 Singapore, a Claude scheduled task in the SP-Survey project (replaced the monthly review on 2026-11-26) | Claude (new project thread each run) | Picks one important or novel perception study (criteria and queue in the project file `notes/paper-library/template-picks.md`), builds it as an SP-Scheme template with redistributable images, publishes it and links the paper; also lists new candidates to approve or reject. | One project + template + `paper_save` link per run. Candidates are changed only after Peter answers. | Ask Claude in the project to delete the scheduled task. |

Candidates are reviewed in 平台管理 → 论文库 → 待审核候选. Only approved papers
appear on /papers and in its counts.

Check what a scan did: `research_paper_scans` (newest first), or the Worker logs
(`[weekly paper scan]`).
