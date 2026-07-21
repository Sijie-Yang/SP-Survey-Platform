# SP-Bench

**SP-Bench: Benchmarking Subjective–Objective Spatial Perception and Cognition in Urban Environments**

Admin-managed multimodal benchmark with encrypted provider credentials, versioned datasets/methods, Queue (or inline) evaluation runners, human review, and a dual-toggle public leaderboard.

## Deploy order

1. **Supabase** — run `supabase/admin_projects_rls.sql` (for `is_platform_admin()`) then `supabase/sp_bench.sql` in the same project as Worker `SUPABASE_URL`. Optionally `NOTIFY pgrst, 'reload schema';`.
2. **Secrets** — Worker already needs `BYOK_ENCRYPTION_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (provider keys reuse AES-GCM BYOK crypto, stored only in `sp_bench_providers`).
3. **Optional Queue** — `wrangler queues create sp-bench-jobs`, then uncomment the `queues` block in `wrangler.jsonc` and redeploy. Without a queue, the admin panel shows “Inline runner” and uses `waitUntil` / async chunk processing.
4. **Worker + React** — `npm run deploy` (or local `npm run dev`).
5. **Keep public off** — leave **Public SP-Bench page** disabled until a method + dataset are frozen, a few models are reviewed, and you intentionally publish.

## Admin workflow (`/admin-dashboard` → SP-Bench)

1. **Providers** — paste API keys (validated, encrypted; UI only shows hint / last-4 style).
2. **Dimensions** — edit template or load suggested dimensions → **Save** → **Freeze method** (`v1`, …).
3. **Dataset** — create draft version → upload images to `bench/datasets/{version}/` → import labels JSON → **Freeze**.
4. **Models** — enable models whose providers have keys → **Run all unevaluated** or per-model Evaluate.
5. **Review** — when status is `needs_review`, approve / reject; **Approve & publish** to enter the public board.
6. **Global toggle** — enable public page / homepage card / header nav only when ready.

## Public surface

| Control | Effect |
|--------|--------|
| Global `public_enabled=false` | `/bench` shows “not open”; header link and landing card hidden; leaderboard API returns empty |
| Model `enabled=false` | Removed from public view immediately (historical runs kept) |
| Run not `approved` + `published` | Not on leaderboard |

APIs:

- `GET /api/bench/public/status` — enabled flag (no secrets)
- `GET /api/bench/public` — published aggregates only (no labels / keys / review notes)
- `GET|PATCH /api/bench/settings` and other `/api/bench/*` — platform admin JWT required

## Security checklist

- Anon / non-admin cannot read `sp_bench_providers` ciphertext or item labels (RLS + service-role Worker).
- Admin UI never receives plaintext keys after save.
- Do not log API keys or BYOK material.
- Tests must use mock providers only (`npm run test:bench`) — never call paid APIs in CI.

## Local

```bash
# .env: SUPABASE_*, BYOK_ENCRYPTION_KEY, REACT_APP_SERVER_URL=http://localhost:3001
npm run dev
npm run test:bench
```
