/**
 * The agent recipe for an SP-Scheme study, from page to data. Shared by
 * sp_scheme_spec, survey_capabilities and GET /api/agent. No imports, so any
 * handler can use it.
 */

// Upload and import limits for the MCP SP-Scheme flow. A Worker has 128 MB:
// an import holds the staged zip and, while it is unpacked, every file in it.
// These are the limits named in the tool descriptions and docs/agent-mcp.md.
/** Largest staged upload (zip or html). */
export const MAX_STAGED_BYTES = 25 * 1024 * 1024;
/** A zip may expand to at most this much; the media files of one import add up to at most this much. */
export const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;
/** Most media files one import uploads. */
export const MAX_IMPORT_MEDIA_FILES = 500;
/** Staged uploads kept per user; older ones are deleted when a new one arrives. */
export const MAX_STAGED_UPLOADS = 5;

export const SP_SCHEME_AGENT_STEPS = Object.freeze([
  '1. Build the study as one index.html that follows the SP-Scheme text (sp_scheme_spec.text). If it uses stimulus files, zip index.html with them, keeping their folders (images/street_01.jpg).',
  '2. Import it: sp_scheme_import { html } for a single page; for a zip, call sp_scheme_upload_url, run its curl line (curl -X PUT --data-binary @study.zip \'<uploadUrl>\'), then sp_scheme_import { uploadId }. Pass projectId to replace the page of an existing study.',
  '3. Read the returned summary. When imported is false, or summary.problems is not empty, fix the page and import it again with the same projectId and expectedDraftUpdatedAt (draftUpdatedAt from the last import). Unchanged media files are not uploaded again; changed ones replace the old ones.',
  '4. survey_publish { projectId, expectedDraftUpdatedAt, confirm: true } releases it to participants. Share links.participant.',
  '5. Later, survey_download_url { projectId } and run its curl line (curl -L -o data.zip \'<downloadUrl>\'). README.txt in the ZIP explains every file and column.',
]);

export const SP_SCHEME_AGENT_TOOLS = Object.freeze([
  'sp_scheme_spec',
  'sp_scheme_upload_url',
  'sp_scheme_import',
  'survey_publish',
  'survey_download_url',
]);

export const SP_SCHEME_WORKFLOW_SUMMARY = 'Recommended: build the whole study as one SP-Scheme web page (sp_scheme_spec), import it with sp_scheme_import (a zip goes up through sp_scheme_upload_url and curl), publish with survey_publish, share links.participant, then download the data with survey_download_url and curl.';

export function spSchemeWorkflow() {
  return {
    summary: SP_SCHEME_WORKFLOW_SUMMARY,
    tools: [...SP_SCHEME_AGENT_TOOLS],
    steps: [...SP_SCHEME_AGENT_STEPS],
  };
}
