# Architecture decision records

Short notes on decisions that shape the platform, written when the decision is made so later contributors know *why*. One file per decision, numbered, never rewritten: a changed decision gets a new record that supersedes the old one.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-deterministic-analysis.md) | Numbers come from deterministic code, not from a model | Accepted |
| [0002](0002-sp-scheme-pages-run-as-is.md) | Uploaded survey pages run as-is; the platform only records | Accepted |
| [0003](0003-mcp-as-the-public-api.md) | The MCP endpoint is the public API; the Python SDK wraps it | Accepted |
| [0004](0004-bench-tasks-in-project-metadata.md) | SP-Bench human tasks are frozen aggregates in project metadata | Accepted |
| [0005](0005-additive-idempotent-sql.md) | Database changes are additive, idempotent SQL run by hand | Accepted |
| [0006](0006-real-stimuli-only.md) | Only real or licensed stimuli; no AI-generated images | Accepted |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What forced a decision.

## Decision
What we do.

## Consequences
What gets easier, what gets harder, what we must keep doing.
```
