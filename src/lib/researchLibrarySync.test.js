import fs from 'fs';
import path from 'path';
import {
  libraryKey,
  planLibrarySync,
  summarizeSyncPlan,
  libraryPaperToRow,
  buildLibraryOverridesExport,
} from './researchLibrarySync';

const filePaper = (over = {}) => ({
  doi: '10.1/a',
  title: 'Paper A',
  year: 2024,
  abstract: 'abs',
  status: 'approved',
  inclusion: { via: 'scopus_v6', reason: 'Scopus export, coarse filter v6' },
  ...over,
});

const onlineRow = (over = {}) => ({
  id: 'row-a',
  doi: '10.1/a',
  title: 'Paper A',
  year: 2024,
  abstract: 'abs',
  status: 'approved',
  template_id: null,
  raw_meta: { library: { via: 'scopus_v6', reason: 'Scopus export, coarse filter v6' } },
  ...over,
});

describe('libraryKey', () => {
  test('uses the normalized DOI', () => {
    expect(libraryKey({ doi: 'https://doi.org/10.1/ABC' })).toBe('doi:10.1/abc');
  });
  test('falls back to title + year like the build script', () => {
    expect(libraryKey({ title: 'Streets: A Study!', year: 2020 })).toBe('title:streets a study|2020');
  });
});

describe('planLibrarySync', () => {
  test('identical file and online rows are unchanged', () => {
    const plan = planLibrarySync([filePaper()], [onlineRow()]);
    expect(plan.unchanged).toBe(1);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.onlineOnly).toEqual([]);
  });

  test('missing online rows are inserted', () => {
    const plan = planLibrarySync([filePaper(), filePaper({ doi: '10.1/b', title: 'B' })], [onlineRow()]);
    expect(plan.toInsert.map((p) => p.doi)).toEqual(['10.1/b']);
  });

  test('template link, status and inclusion follow the file', () => {
    const plan = planLibrarySync(
      [filePaper({ template_id: '2025-x', inclusion: { via: 'template', reason: 'Paper of template 2025-x' } })],
      [onlineRow({ status: 'archived', raw_meta: {} })],
    );
    expect(plan.toUpdate).toHaveLength(1);
    const { changes, patch } = plan.toUpdate[0];
    expect(changes.status).toEqual({ from: 'archived', to: 'approved' });
    expect(changes.template_id).toEqual({ from: null, to: '2025-x' });
    expect(patch.template_fit).toBe('likely');
    expect(patch.raw_meta.library.via).toBe('template');
  });

  test('an online link the file does not have is cleared', () => {
    const plan = planLibrarySync([filePaper()], [onlineRow({ template_id: 'old-id' })]);
    expect(plan.toUpdate[0].changes.template_id).toEqual({ from: 'old-id', to: null });
    expect(plan.toUpdate[0].patch.template_id).toBeNull();
  });

  test('approved online rows missing from the file are listed, never deleted', () => {
    const plan = planLibrarySync([filePaper()], [
      onlineRow(),
      onlineRow({ id: 'row-x', doi: '10.1/x', title: 'X' }),
      onlineRow({ id: 'row-y', doi: '10.1/y', title: 'Y', status: 'archived' }),
    ]);
    expect(plan.onlineOnly.map((r) => r.id)).toEqual(['row-x']);
  });

  test('DOI case and URL form do not create duplicates', () => {
    const plan = planLibrarySync([filePaper({ doi: '10.1/A' })], [onlineRow({ doi: 'https://doi.org/10.1/a' })]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  test('reports duplicate online rows', () => {
    const plan = planLibrarySync([filePaper()], [onlineRow(), onlineRow({ id: 'row-a2' })]);
    expect(plan.duplicateOnline).toEqual([{ key: 'doi:10.1/a', ids: ['row-a', 'row-a2'] }]);
  });

  test('summary counts each kind of change', () => {
    const plan = planLibrarySync(
      [filePaper({ template_id: 't' }), filePaper({ doi: '10.1/b', title: 'B' })],
      [onlineRow(), onlineRow({ id: 'z', doi: '10.1/z', title: 'Z' })],
    );
    expect(summarizeSyncPlan(plan)).toMatchObject({ insert: 1, update: 1, onlineOnly: 1, template_id: 1 });
  });
});

describe('libraryPaperToRow', () => {
  test('keeps the inclusion record in raw_meta and approves the row', () => {
    const row = libraryPaperToRow(filePaper({ template_id: '2025-x', raw_meta: { import: 'coarse_v6' } }));
    expect(row.status).toBe('approved');
    expect(row.template_id).toBe('2025-x');
    expect(row.template_fit).toBe('likely');
    expect(row.raw_meta).toEqual({ import: 'coarse_v6', library: filePaper().inclusion });
    expect(row.paper_url).toBe('https://doi.org/10.1/a');
  });
});

describe('buildLibraryOverridesExport', () => {
  test('exports online additions, archived rows and changed links', () => {
    const out = buildLibraryOverridesExport(
      [
        onlineRow(),
        onlineRow({ id: 'n', doi: '10.1/new', title: 'New', template_id: 'tpl-new', authors: ['Doe J.'] }),
        onlineRow({ id: 'b', doi: '10.1/b', title: 'B', status: 'archived' }),
        onlineRow({ id: 'c', doi: '10.1/c', title: 'C', template_id: 'tpl-c' }),
      ],
      [filePaper(), filePaper({ doi: '10.1/b', title: 'B' }), filePaper({ doi: '10.1/c', title: 'C' })],
      { date: '2026-10-15' },
    );
    expect(out.include).toHaveLength(1);
    expect(out.include[0]).toMatchObject({ doi: '10.1/new', via: 'admin_added', added: '2026-10-15' });
    expect(out.include[0].paper.authors).toEqual(['Doe J.']);
    expect(out.exclude.map((e) => e.doi)).toEqual(['10.1/b']);
    expect(out.template_links.map((l) => [l.doi, l.template_id])).toEqual([
      ['10.1/new', 'tpl-new'],
      ['10.1/c', 'tpl-c'],
    ]);
  });

  test('a synced library exports nothing', () => {
    const out = buildLibraryOverridesExport([onlineRow()], [filePaper()]);
    expect(out.include).toEqual([]);
    expect(out.exclude).toEqual([]);
    expect(out.template_links).toEqual([]);
  });
});

describe('library.json in the repo', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'research', 'library.json'), 'utf8'));
  const tplDir = path.join(ROOT, 'public', 'project_templates');
  const index = JSON.parse(fs.readFileSync(path.join(tplDir, 'index.json'), 'utf8'));

  test('has no duplicate keys and every paper records why it is included', () => {
    const keys = lib.papers.map(libraryKey);
    expect(new Set(keys).size).toBe(keys.length);
    lib.papers.forEach((p) => {
      expect(p.status).toBe('approved');
      expect(p.inclusion?.via).toBeTruthy();
      expect(p.inclusion?.reason).toBeTruthy();
    });
    expect(lib.count).toBe(lib.papers.length);
  });

  test('every template with a DOI is linked to exactly its paper', () => {
    const byKey = new Map(lib.papers.map((p) => [libraryKey(p), p]));
    const linkedIds = lib.papers.filter((p) => p.template_id).map((p) => p.template_id);
    expect(new Set(linkedIds).size).toBe(linkedIds.length);
    index.templates.forEach((file) => {
      const tpl = JSON.parse(fs.readFileSync(path.join(tplDir, file), 'utf8'));
      if (!tpl.doi) return;
      const paper = byKey.get(libraryKey({ doi: tpl.doi }));
      expect(paper && paper.template_id).toBe(tpl.id);
    });
  });
});
