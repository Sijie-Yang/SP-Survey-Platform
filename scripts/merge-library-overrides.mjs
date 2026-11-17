#!/usr/bin/env node
/**
 * Merge an "导出线上改动" file from Admin → 论文库 into research/library/overrides.json.
 *
 * Usage:
 *   node scripts/merge-library-overrides.mjs ~/Downloads/library-overrides-export-2026-10-15.json
 *   npm run research:library        # rebuild public/research/library.json
 *
 * Entries already present (same DOI, or title + year) are skipped, so merging the
 * same export twice is harmless. The rebuild reports any conflict, e.g. an online
 * link to a template whose file DOI points at another paper.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overridesPath = path.join(root, 'research/library/overrides.json');
const exportPath = process.argv[2];
if (!exportPath) {
  console.error('Usage: node scripts/merge-library-overrides.mjs <library-overrides-export.json>');
  process.exit(1);
}

const normalizeDoi = (raw) => {
  if (!raw) return null;
  const m = String(raw).match(/10\.\d{4,9}\/[^\s"'<>#?]+/i);
  return m ? m[0].toLowerCase().replace(/\/+$/, '') : null;
};
const keyOf = (entry) => {
  const doi = normalizeDoi(entry.doi);
  if (doi) return `doi:${doi}`;
  const title = String(entry.title || entry.paper?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `title:${title}|${entry.year || entry.paper?.year || ''}`;
};

const exported = JSON.parse(fs.readFileSync(path.resolve(exportPath), 'utf8'));
if (exported.format !== 'sp-survey-library-overrides-export') {
  console.error(`${exportPath} is not an export from Admin → 论文库 → 导出线上改动`);
  process.exit(1);
}
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));

const added = {};
for (const section of ['include', 'exclude', 'template_links']) {
  overrides[section] = overrides[section] || [];
  const seen = new Set(overrides[section].map((e) => (section === 'template_links' ? `${keyOf(e)}→${e.template_id}` : keyOf(e))));
  added[section] = 0;
  for (const entry of exported[section] || []) {
    const k = section === 'template_links' ? `${keyOf(entry)}→${entry.template_id}` : keyOf(entry);
    if (seen.has(k)) continue;
    seen.add(k);
    overrides[section].push(entry);
    added[section] += 1;
  }
}

fs.writeFileSync(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
console.log(`Merged into research/library/overrides.json: ${JSON.stringify(added)}`);
console.log('Next: npm run research:library, then commit, then Admin → 论文库 → 从文件同步.');
