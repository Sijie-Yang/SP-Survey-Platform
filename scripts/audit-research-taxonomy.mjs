#!/usr/bin/env node
/**
 * Audit taxonomy v4 extraction against shortlist JSON.
 *
 * Usage:
 *   node scripts/audit-research-taxonomy.mjs
 *   node scripts/audit-research-taxonomy.mjs --in public/research/scopus-shortlist.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const metaMod = await import(pathToFileURL(path.join(root, 'src/lib/researchPaperMeta.mjs')).href);
const {
  extractAnalysisMeta,
  EXTRACTION_VERSION,
  validateMetaInvariants,
  TAXONOMY,
} = metaMod;

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const inPath = path.resolve(
  root,
  argValue('--in', 'public/research/scopus-shortlist.json'),
);
const payload = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const papers = payload.papers || [];

const fields = Object.keys(TAXONOMY);
const counts = Object.fromEntries(fields.map((f) => [f, new Map()]));
const scopes = {};
const invariantCounts = {};
let stale = 0;
let legacyAlias = 0;
let streetViewScaleLeak = 0;

function sampleEvidence(map, id, paper, field) {
  if (!map.has(id)) map.set(id, []);
  const arr = map.get(id);
  if (arr.length >= 3) return;
  arr.push({
    title: paper.title,
    evidence: paper.analysis_meta?.evidence?.[id] || null,
    field,
  });
}

const evidenceSamples = Object.fromEntries(fields.map((f) => [f, new Map()]));

for (const paper of papers) {
  const stored = paper.analysis_meta;
  const fresh = extractAnalysisMeta(paper);
  if (stored?.extraction_version !== EXTRACTION_VERSION) stale += 1;

  const meta = stored?.extraction_version === EXTRACTION_VERSION ? stored : fresh;
  const violations = validateMetaInvariants(meta, paper);
  for (const v of violations) {
    invariantCounts[v] = (invariantCounts[v] || 0) + 1;
    if (v.startsWith('legacy_')) legacyAlias += 1;
    if (v === 'street_scale_from_street_view_only') streetViewScaleLeak += 1;
  }

  scopes[meta.analysis_scope] = (scopes[meta.analysis_scope] || 0) + 1;
  for (const field of fields) {
    for (const id of meta[field] || []) {
      counts[field].set(id, (counts[field].get(id) || 0) + 1);
      sampleEvidence(evidenceSamples[field], id, { ...paper, analysis_meta: meta }, field);
    }
  }
}

function topMap(map, n = 8) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const report = {
  extraction_version: EXTRACTION_VERSION,
  total: papers.length,
  stale_or_missing_v4: stale,
  scopes,
  invariant_violations: invariantCounts,
  street_view_scale_leak: streetViewScaleLeak,
  legacy_alias_hits: legacyAlias,
  top_labels: Object.fromEntries(
    fields.map((f) => [f, topMap(counts[f])]),
  ),
  evidence_samples: Object.fromEntries(
    fields.map((f) => [
      f,
      Object.fromEntries(
        [...evidenceSamples[f].entries()].slice(0, 6).map(([id, samples]) => [id, samples]),
      ),
    ]),
  ),
};

const outDir = path.join(root, 'research/scopus/audits');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${new Date().toISOString().slice(0, 10)}_taxonomy_v4_audit.json`);
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  wrote: outPath,
  total: report.total,
  scopes: report.scopes,
  street_view_scale_leak: report.street_view_scale_leak,
  invariant_violations: report.invariant_violations,
  top_response_protocols: report.top_labels.response_protocols,
  top_visual_sources: report.top_labels.visual_data_sources,
  top_scales: report.top_labels.spatial_scales,
}, null, 2));
