/**
 * Switching a study between its SP-Scheme page and the classic editor.
 *
 * To classic: the whole draft (page included) is kept as a backup in
 * projects.metadata.spSchemeBackups, then the draft loses its page, so
 * participants get the classic questions (the page's declared questions stay
 * as classic question pages). The draft carries spSchemeBackupAt so the
 * editors can offer to bring the page back.
 * Back to SP-Scheme: the latest backup becomes the draft again.
 *
 * Published versions are not touched: what participants open changes only
 * when the researcher publishes, and every published version stays in the
 * version history.
 */

import { loadOwned } from './projectLifecycle.mjs';
import { saveDraft } from './projectHandlers.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import { sanitizeForAgent } from '../designProtocol.mjs';

export const SP_SCHEME_BACKUPS_KEY = 'spSchemeBackups';
export const MAX_SP_SCHEME_BACKUPS = 3;

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

// Without stored credentials: saveDraft puts them back, and backups never hold them.
function draftOf(row) {
  return sanitizeForAgent(row?.survey_config_draft ?? row?.survey_config ?? {});
}

/** The draft without its page: the page's questions stay as classic question pages. */
export function classicConfigFromPage(config, savedAt) {
  const next = JSON.parse(JSON.stringify(config || {}));
  delete next.spSite;
  if (!Array.isArray(next.pages)) next.pages = [];
  next.spSchemeBackupAt = savedAt;
  return next;
}

/** Metadata with the draft added as the newest backup (at most MAX_SP_SCHEME_BACKUPS kept). */
export function withBackup(metadata, config, savedAt) {
  const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const list = Array.isArray(meta[SP_SCHEME_BACKUPS_KEY]) ? meta[SP_SCHEME_BACKUPS_KEY] : [];
  meta[SP_SCHEME_BACKUPS_KEY] = [{ savedAt, config }, ...list].slice(0, MAX_SP_SCHEME_BACKUPS);
  return meta;
}

/** The newest backup and the metadata without it; null when there is none. */
export function takeBackup(metadata) {
  const list = Array.isArray(metadata?.[SP_SCHEME_BACKUPS_KEY]) ? metadata[SP_SCHEME_BACKUPS_KEY] : [];
  const latest = list.find((item) => item?.config?.spSite?.html);
  if (!latest) return null;
  return {
    backup: latest,
    metadata: { ...metadata, [SP_SCHEME_BACKUPS_KEY]: list.filter((item) => item !== latest) },
  };
}

async function patchMetadata(env, ctx, projectId, draftUpdatedAt, metadata) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    accessToken: ctx.accessToken,
    query: `?id=eq.${encodeURIComponent(projectId)}&draft_updated_at=eq.${encodeURIComponent(draftUpdatedAt)}&select=id`,
    body: { metadata },
    prefer: 'return=representation',
  });
  if (!Array.isArray(rows) || !rows.length) {
    throw fail('The study changed in the meantime. Reload it and try again.', 409, 'CONFLICT');
  }
}

/**
 * @param {object} ctx { accessToken, userId }
 * @param {{ projectId: string, direction: 'classic'|'spscheme' }} body
 */
export async function switchSpSchemeEditor(env, ctx, body, io = {}) {
  const load = io.loadOwned || loadOwned;
  const save = io.saveDraft || saveDraft;
  const writeMeta = io.patchMetadata || patchMetadata;
  const projectId = String(body?.projectId || '');
  const direction = body?.direction;
  if (direction !== 'classic' && direction !== 'spscheme') throw fail('direction must be classic or spscheme');
  const row = await load(env, { accessToken: ctx.accessToken, userId: ctx.userId, projectId });
  const draft = draftOf(row);
  const now = new Date().toISOString();

  if (direction === 'classic') {
    if (!draft?.spSite?.html) return { success: true, changed: false, draftUpdatedAt: row.draft_updated_at };
    // Backup first: a failed draft save leaves an extra backup, never a lost page.
    await writeMeta(env, ctx, projectId, row.draft_updated_at, withBackup(row.metadata, draft, now));
    const saved = await save(env, ctx.accessToken, projectId, {
      surveyConfig: classicConfigFromPage(draft, now),
      expectedDraftUpdatedAt: row.draft_updated_at,
      writer: { tool: 'switch_to_classic' },
    }, 'studio', null, { replacePage: true });
    return { success: true, changed: true, backupAt: now, draftUpdatedAt: saved?.draftUpdatedAt };
  }

  if (draft?.spSite?.html) return { success: true, changed: false, draftUpdatedAt: row.draft_updated_at };
  const taken = takeBackup(row.metadata);
  if (!taken) throw fail('There is no saved SP-Scheme page to bring back.', 404, 'NO_BACKUP');
  const saved = await save(env, ctx.accessToken, projectId, {
    surveyConfig: taken.backup.config,
    expectedDraftUpdatedAt: row.draft_updated_at,
    writer: { tool: 'restore_sp_scheme_page' },
  }, 'studio', null, { replacePage: true });
  await writeMeta(env, ctx, projectId, saved?.draftUpdatedAt, taken.metadata).catch(() => null);
  return { success: true, changed: true, restoredFrom: taken.backup.savedAt, draftUpdatedAt: saved?.draftUpdatedAt };
}
