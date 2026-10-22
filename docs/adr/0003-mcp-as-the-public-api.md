# 0003. The MCP endpoint is the public API; the Python SDK wraps it

- Status: Accepted
- Date: 2026-10-22

## Context

Agents (Codex, Claude Code, Cursor) already reach the platform through `/mcp` with OAuth scopes. Researchers also want scripts and notebooks. A second REST API would need its own auth, docs and tests and would drift from what agents see.

## Decision

`/mcp` (JSON-RPC `tools/call`) is the one programmatic interface. The `spsurvey` Python package calls those tools with the same OAuth flow (PKCE, loopback redirect) and adds no computation of its own. New capabilities are added as MCP tools first, then exposed in the SDK.

## Consequences

- A number from the SDK equals the number on the Results page.
- Tools must stay backwards compatible; renames keep an alias for at least one minor release.
- Actions that spend money (silicon runs) stay in the browser; the SDK only reads their results.
