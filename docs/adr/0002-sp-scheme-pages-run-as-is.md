# 0002. Uploaded survey pages run as-is; the platform only records

- Status: Accepted (supersedes the model-based "convert" step)
- Date: 2026-10-15

## Context

Researchers can hand the platform a whole survey page (SP-Scheme: an LLM-built `index.html` or a zip). A first version asked a model to rewrite such pages into native questions. Conversions failed silently, lost the page's own randomisation, and needed repeated retries.

## Decision

Uploaded pages are served unchanged. The platform records what the page stores and sends, uploads the zip's images into the media library under their own folder names, and fills image lists by deterministic filename rules. Pages built to the SP-Scheme contract get native analysis; other pages get one whole-page record and a raw export ("analyse it yourself").

## Consequences

- No answer is lost to a failed conversion.
- Builder shows uploaded pages read-only; editing means replacing the page.
- The SP-Scheme contract (`docs/sp-scheme.md`) is the only way to get platform analysis for a custom page, so it must stay small and stable.
