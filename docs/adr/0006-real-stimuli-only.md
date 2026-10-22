# 0006. Only real or licensed stimuli; no AI-generated images

- Status: Accepted
- Date: 2026-09-16

## Context

Perception studies measure how people respond to real places. Generated images carry the generator's biases, cannot be traced to a location, and would contaminate datasets that others reuse and cite.

## Decision

The platform, its agents and its templates never generate or upload synthetic images as stimuli. Templates bundle only photographs that the source paper published or that carry an open licence, with the source recorded in `images.json`. Agent instructions (`AGENTS.md`, MCP tool descriptions) repeat the rule.

## Consequences

- Some template ideas wait until real images are available.
- Studies that deliberately use generated images (e.g. counterfactual designs) must be set up by the researcher with their own files and disclosed in their Methods.
