# 0001. Numbers come from deterministic code, not from a model

- Status: Accepted
- Date: 2026-10-15

## Context

The platform offers an assistant model to every user for free. It is a small, fast model and does not follow long instructions reliably. Early versions let it convert uploaded survey pages and write analysis code; mistakes there (wrong image mapped to an answer, a rating column dropped) would end up in published papers and could not be detected afterwards.

## Decision

Anything a reviewer could check (TrueSkill scores, means, agreement statistics, image-to-answer mapping, export columns, citation text) is computed by plain functions in `src/lib/` or `worker-lib/` with unit tests. A model may draft text, propose a survey design, or write an optional per-question analysis that runs in a sandbox next to the platform's own statistics; its output is always labelled and never replaces them.

## Consequences

- Results are reproducible from the raw export with the same code (the SDK calls the same functions through `/mcp`).
- Features that "just ask the model" are rejected unless a deterministic fallback produces the core result.
- Changing a formula is a versioned change (see [RELEASING](../RELEASING.md)).
