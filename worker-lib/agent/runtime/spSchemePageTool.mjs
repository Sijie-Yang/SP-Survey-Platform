/**
 * sp_scheme_write_page: the Assistant's SP-Scheme mode writes or changes the
 * study page through this one tool.
 *
 * The tool reads the current page, has the model write the new one
 * (spSchemeGenerate.mjs: Studio's import check plus repair rounds), and saves
 * it with the same import path as MCP sp_scheme_import only when the check
 * passes. A page that does not pass is not saved; the problems come back.
 *
 * The page writer is told what the study's media library holds, so a request
 * like "fit the page to the images I uploaded" works as it is; what the page
 * still asks for that the library lacks comes back as mediaNotes.
 */

import { writeSpSchemePage } from '../spSchemeGenerate.mjs';
import { importSpScheme } from '../spSchemeAgent.mjs';
import { loadOwned } from '../projectLifecycle.mjs';
import { getDraft } from '../projectHandlers.mjs';
import { modeToolError } from './modes.mjs';

export const SP_SCHEME_WRITE_TOOL = 'sp_scheme_write_page';

function draftConfig(row) {
  return row?.survey_config_draft ?? row?.survey_config ?? {};
}

/**
 * @param {object} deps
 * @param {object} deps.route model route for the page writer (apiKey, provider, baseUrl, model, modelRecord, protocol, compat, extra)
 * @param {Function} [deps.chat] chatCompletions (tests pass a fake)
 * @param {object} [deps.io] { loadOwned, importSpScheme, getDraft } (tests pass fakes)
 */
export function createSpSchemePageTool({
  env,
  accessToken = null,
  ownerUserId = null,
  userId = null,
  getProjectId,
  request,
  route,
  chat,
  io = {},
}) {
  const load = io.loadOwned || loadOwned;
  const save = io.importSpScheme || importSpScheme;
  const readDraft = io.getDraft || getDraft;
  const owner = ownerUserId || userId;
  const ctx = accessToken
    ? { accessToken, userId: owner }
    : { serviceRole: true, userId: owner };

  return {
    name: SP_SCHEME_WRITE_TOOL,
    description: 'Write or change the study\'s SP-Scheme page (the whole participant page). Pass request: what the page should be (for a new study) or exactly what to change, with every detail the researcher gave (topic, tasks, number of trials, questions, wording, language). The page writer already sees the study\'s media library (folders, file names, counts), so to fit the page to the uploaded images just say so; never ask the researcher to list files. The platform writes the page, checks it and saves it only when it passes. Returns saved, a short note on what changed, any problems, and mediaNotes: folders or files the page asks for that the media library does not hold (tell the researcher).',
    minPermission: 'edit_draft',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['request'],
      properties: {
        request: { type: 'string', description: 'What to build or change, in full.' },
      },
    },
    async execute(args) {
      const projectId = getProjectId?.();
      if (!projectId) throw new Error('projectId is required');
      const text = String(args?.request || '').trim();
      if (!text) {
        throw modeToolError({
          code: 'INVALID_TOOL_ARGUMENTS',
          path: 'request',
          message: 'request is required: say what the page should be or what to change.',
          retryAction: 'repair_args',
        });
      }
      const row = await load(env, { ...ctx, projectId });
      const currentHtml = draftConfig(row)?.spSite?.html || '';
      const chatFn = chat || (await import('./providers.mjs')).chatCompletions;
      const written = await writeSpSchemePage({
        chat: chatFn,
        route,
        request: text,
        currentHtml,
        mediaLibrary: Array.isArray(row?.preloaded_images) ? row.preloaded_images : [],
        mediaPrefix: row?.user_id ? `${row.user_id}/${projectId}/` : null,
      });
      if (!written.passed) {
        return {
          saved: false,
          error: 'The page did not pass the platform check, so nothing was saved.',
          code: 'SP_SCHEME_PAGE_PROBLEMS',
          problems: written.check.problems.slice(0, 10),
          note: written.reply,
        };
      }
      const imported = await save(env, ctx, {
        projectId,
        html: written.html,
        expectedDraftUpdatedAt: row.draft_updated_at || undefined,
      }, request);
      if (!imported?.imported) {
        return {
          saved: false,
          error: 'The page could not be saved.',
          code: 'SP_SCHEME_PAGE_PROBLEMS',
          problems: imported?.summary?.problems || [],
        };
      }
      // The same view of the draft survey_get_draft returns, so the runtime can verify it.
      const draft = await readDraft(env, accessToken, projectId, request, accessToken ? null : owner);
      return {
        summary: written.reply || (currentHtml ? 'Changed the page and saved it' : 'Wrote the page and saved it'),
        saved: true,
        note: written.reply,
        changed: currentHtml ? 'page_changed' : 'page_created',
        questionCount: written.check.questionCount,
        matchLevel: written.check.matchLevel,
        ...(written.check.mediaNotes?.length ? { mediaNotes: written.check.mediaNotes } : {}),
        draftUpdatedAt: draft?.draftUpdatedAt || imported.draftUpdatedAt,
        surveyConfig: draft?.surveyConfig,
        spSchemePageChanged: true,
      };
    },
  };
}
