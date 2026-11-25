/**
 * The SP-Scheme import library runs under plain Node (and so in the Worker,
 * for the MCP server) exactly as in the browser.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { buildExampleZip, readSpSchemeUpload } from '../../src/lib/spScheme.js';
import {
  finalizeSpSchemeImport,
  prepareSpSchemeUpload,
  spSchemeMediaPlan,
  summarizeSpSchemeImport,
} from '../../src/lib/spSchemeImport.js';
import { uploadPlannedMedia } from '../../src/lib/spSchemeMediaImport.js';

const here = dirname(fileURLToPath(import.meta.url));
const libEntry = resolve(here, '../../src/lib/spSchemeImport.js');

// Every module the library pulls in, by a static read of its import lines.
function importGraph(entry) {
  const seen = new Map();
  const walk = (file) => {
    if (seen.has(file)) return;
    const source = readFileSync(file, 'utf8');
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2]);
    seen.set(file, specifiers);
    specifiers.filter((spec) => spec.startsWith('.')).forEach((spec) => {
      const target = join(dirname(file), spec);
      if (existsSync(target)) walk(target);
    });
  };
  walk(entry);
  return seen;
}

describe('SP-Scheme import library under Node', () => {
  it('imports nothing browser-only, and every relative import names its file', () => {
    const graph = importGraph(libEntry);
    assert.ok(graph.size > 5);
    for (const [file, specifiers] of graph) {
      assert.doesNotMatch(file, /(supabase|skillManager|surveyMediaInjection|spSite)\.js$/, `${file} must stay out of the import graph`);
      for (const spec of specifiers) {
        if (spec.startsWith('.')) {
          assert.match(spec, /\.m?js$/, `${file} imports "${spec}" without its .js extension`);
          assert.ok(existsSync(join(dirname(file), spec)), `${file} imports missing "${spec}"`);
        } else {
          assert.equal(spec, 'fflate', `${file} imports the package "${spec}"`);
        }
      }
    }
  });

  it('runs the example zip through prepare and finalize', () => {
    const prepared = prepareSpSchemeUpload(readSpSchemeUpload(buildExampleZip()), { name: 'example.zip' });
    assert.equal(prepared.report.ok, true);
    assert.equal(prepared.upload.asIs, undefined);

    const summary = summarizeSpSchemeImport(prepared);
    assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
    assert.equal(summary.ok, true);
    assert.equal(summary.asIs, false);
    assert.equal(summary.matchLevel, 'full');
    assert.equal(summary.title, 'Street perception study');
    assert.equal(summary.questionCount, 3);
    assert.deepEqual(summary.problems, []);

    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, { theme: { primaryColor: '#123456' } });
    assert.equal(next.theme.primaryColor, '#123456');
    assert.match(next.spSite.id, /^site-[0-9a-f]{16}$/);
    assert.match(next.spSite.html, /SPSite\.onReady/);
    assert.doesNotMatch(next.spSite.html, /sp-site-preview/);
    assert.equal(next.spSite.convertedFrom, undefined);
    assert.equal(next.pages.length, 3);
  });

  it('plans, uploads and links the media of an as-is zip with injected storage', async () => {
    const page = '<!doctype html><html><body><script>const PHOTO_URLS = []; localStorage.setItem("answers", "{}");</script></body></html>';
    const zip = zipSync({ 'study/index.html': strToU8(page), 'study/images/a.jpg': new Uint8Array([1, 2, 3]) });
    const prepared = prepareSpSchemeUpload(readSpSchemeUpload(zip), { name: 'study.zip' });
    assert.ok(prepared.upload.asIs);
    const plan = spSchemeMediaPlan(prepared.upload);
    assert.deepEqual(summarizeSpSchemeImport(prepared).media, { files: 1, folders: [{ folder: 'images', full: 'images', count: 1 }] });

    const keys = [];
    const saves = [];
    const result = await uploadPlannedMedia({
      plan,
      project: { id: 'p1', preloadedImages: [] },
      userId: 'u1',
      upload: async (file, key) => { keys.push([key, file.type, file.size]); return { success: true, url: `https://media.example/${key}` }; },
      onProjectUpdate: async (project) => { saves.push(project); },
    });
    assert.deepEqual(result.failures, []);
    assert.equal(keys.length, 1);
    assert.match(keys[0][0], /^u1\/p1\/images\/a__[^/]+\.jpg$/);
    assert.deepEqual(keys[0].slice(1), ['image/jpeg', 3]);
    assert.equal(saves.at(-1).preloadedImages[0].folder, 'images');

    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
    assert.deepEqual(next.spSite.mediaFolders, ['images']);
    assert.equal(next.spSite.convertedFrom, 'study.zip');
  });
});
