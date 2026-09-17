# Silicon background runs — Flash accept 2026-09-16

Local only. Model: `qwen-dashscope` / `qwen3.8-flash`. SQL `supabase/silicon_background_runs.sql` is provided, not applied.

Project A: `Silicon media accept` `proj_1789551035192_c15a48d4da`  
Project B: `Queue mixed session` `proj_1789550895154_74540273d4`

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | Start a multi-minute Silicon on A | 通过 | Flash, Walker A, 3 questions × 3 repeats = 9 units. Run `a2fbe9df-6716-439d-b3af-469dafb85859` dispatched from `POST /runs` (202). No frontend `pumpRun`. |
| 2 | Switch to B; global entry still shows A | 通过 | On Queue mixed session, sidebar `Tasks · 1`, process header `proj_1789551035192_c15a48d4da · Running`, `Finished 2 / 9`, `Processed 2 / 9: valid 2`. |
| 3 | Assistant on B stays independent | 通过 | Chat composer enabled (`Type a message…`). History kept (8-page Q&A / theme). Silicon cancel does not call Assistant `cancelRun`. |
| 4 | Open A process then return to chat | 通过 | Dual tabs; switching does not clear chat. After refresh, generate cards and composer still present. |
| 5 | Refresh: restore, no zero, no duplicate | 通过 | Reload `/admin` → `Tasks · 0` (cancelled, not re-queued). Completed prior run `353b432f` stayed `3 / 3 valid`. |
| 6 | Stop mid-run; keep saved units | 通过 | Cancel at 2–3/9. Final: status `cancelled`, `processed 3 / 9`, `valid 3`, `pending 6`. No further units started. |
| 7 | Two browsers, same task | 通过 | Second admin tab `46c8ca` shows `Tasks · 0`. No second running Silicon. |
| 8 | Mobile close/open panel | 通过 | 390×844: compact menu `Tasks · 0 running`, drawer `min(420px, 100vw)`, Tasks tab tappable. |
| 9 | Progress / valid / fail / export match | 通过 | Progress, tasks list, and export all `processed 3, valid 3, failed 0, pending 6, total 9`. Export: 9 units, 1 response envelope, 3 CSV answer rows. |

Earlier 3-unit Flash run `353b432f-06a2-4c2a-8b62-5ccd108e2d19` completed `valid 3` with live timeline (`unit.start` → `media.ready` → `model.request` → `validate.ok` → `unit.saved`). A stuck `running` after 3/3 (Assistant busy) was fixed by finalize-before-yield.

Unit tests: `node --test worker-lib/silicon/*.test.mjs` and `runDispatcher` silicon kind; Jest `siliconSupport` / `SiliconSamples` (no `process` after start).
