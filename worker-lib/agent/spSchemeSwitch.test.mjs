import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SP_SCHEME_BACKUPS,
  classicConfigFromPage,
  switchSpSchemeEditor,
  takeBackup,
  withBackup,
} from './spSchemeSwitch.mjs';

const PAGE_DRAFT = {
  title: 'Streets',
  pages: [{ name: 'p1', elements: [{ type: 'rating', name: 'safe' }] }],
  spSite: { html: '<html>page</html>', id: 'site1' },
};

function fakeStore(row) {
  const state = { row: JSON.parse(JSON.stringify(row)), saves: [], metas: [] };
  const io = {
    loadOwned: async () => JSON.parse(JSON.stringify(state.row)),
    saveDraft: async (env, token, projectId, body, source, owner, opts) => {
      assert.equal(body.expectedDraftUpdatedAt, state.row.draft_updated_at);
      assert.equal(opts.replacePage, true);
      state.saves.push(body.surveyConfig);
      state.row.survey_config_draft = body.surveyConfig;
      state.row.draft_updated_at = `t${state.saves.length + 1}`;
      return { draftUpdatedAt: state.row.draft_updated_at };
    },
    patchMetadata: async (env, ctx, projectId, stamp, metadata) => {
      assert.equal(stamp, state.row.draft_updated_at);
      state.metas.push(metadata);
      state.row.metadata = metadata;
    },
  };
  return { state, io };
}

describe('switching a study between its SP-Scheme page and the classic editor', () => {
  it('keeps the page questions as classic questions and marks the backup', () => {
    const next = classicConfigFromPage(PAGE_DRAFT, 'now');
    assert.equal(next.spSite, undefined);
    assert.deepEqual(next.pages, PAGE_DRAFT.pages);
    assert.equal(next.spSchemeBackupAt, 'now');
    assert.deepEqual(classicConfigFromPage({ spSite: { html: 'x' } }, 'n').pages, []);
  });

  it('keeps at most a few backups, newest first, and takes the newest back', () => {
    let meta = { other: 1 };
    for (let i = 0; i < MAX_SP_SCHEME_BACKUPS + 2; i += 1) meta = withBackup(meta, { ...PAGE_DRAFT, title: `v${i}` }, `t${i}`);
    assert.equal(meta.spSchemeBackups.length, MAX_SP_SCHEME_BACKUPS);
    assert.equal(meta.other, 1);
    const taken = takeBackup(meta);
    assert.equal(taken.backup.config.title, `v${MAX_SP_SCHEME_BACKUPS + 1}`);
    assert.equal(taken.metadata.spSchemeBackups.length, MAX_SP_SCHEME_BACKUPS - 1);
    assert.equal(takeBackup({}), null);
  });

  it('to classic: backs the page up first, then saves the draft without it; back again restores it', async () => {
    const { state, io } = fakeStore({ draft_updated_at: 't1', survey_config_draft: PAGE_DRAFT, metadata: { keep: true } });
    const ctx = { accessToken: 'tok', userId: 'u1' };
    const toClassic = await switchSpSchemeEditor({}, ctx, { projectId: 'p1', direction: 'classic' }, io);
    assert.equal(toClassic.changed, true);
    assert.equal(state.metas[0].spSchemeBackups[0].config.spSite.html, '<html>page</html>');
    assert.equal(state.metas[0].keep, true);
    assert.equal(state.saves[0].spSite, undefined);
    assert.ok(state.saves[0].spSchemeBackupAt);

    // Already classic: nothing to do.
    const again = await switchSpSchemeEditor({}, ctx, { projectId: 'p1', direction: 'classic' }, io);
    assert.equal(again.changed, false);

    const back = await switchSpSchemeEditor({}, ctx, { projectId: 'p1', direction: 'spscheme' }, io);
    assert.equal(back.changed, true);
    assert.equal(state.row.survey_config_draft.spSite.html, '<html>page</html>');
    assert.equal(state.row.survey_config_draft.spSchemeBackupAt, undefined);
    assert.equal(state.row.metadata.spSchemeBackups.length, 0);
  });

  it('refuses a bad direction and a restore with no backup', async () => {
    const { io } = fakeStore({ draft_updated_at: 't1', survey_config_draft: { pages: [] }, metadata: {} });
    await assert.rejects(switchSpSchemeEditor({}, {}, { projectId: 'p1', direction: 'x' }, io), /direction/);
    await assert.rejects(switchSpSchemeEditor({}, {}, { projectId: 'p1', direction: 'spscheme' }, io), (e) => e.code === 'NO_BACKUP');
  });
});
