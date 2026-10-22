# 0005. Database changes are additive, idempotent SQL run by hand

- Status: Accepted
- Date: 2026-09-10

## Context

The hosted instance and every self-hosted copy run their own Supabase project. There is no migration runner, and operators apply SQL in the dashboard, sometimes twice, sometimes out of order.

## Decision

Each feature ships one `supabase/<feature>.sql` file that is safe to re-run (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP ... IF EXISTS`). Changes only add columns, tables, functions and policies; removals happen in a later file after the code no longer uses them. Where possible new state goes in existing JSON columns (`projects.metadata`, `config`) so no SQL is needed at all. `npm run sql:check` and the PGlite replay in CI enforce this.

## Consequences

- Rolling back code never needs a database rollback.
- PR bodies must name any SQL file to run.
