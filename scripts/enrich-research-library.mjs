#!/usr/bin/env node
/**
 * Enrich Scopus shortlist JSON with rule-based analysis_meta (taxonomy v4).
 *
 * Usage:
 *   node scripts/enrich-research-library.mjs
 *   node scripts/enrich-research-library.mjs --in path --out path [--also path2]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const metaMod = await import(pathToFileURL(path.join(root, 'src/lib/researchPaperMeta.mjs')).href);
const { extractAnalysisMeta, EXTRACTION_VERSION } = metaMod;

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function alsoOutputs() {
  const outs = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--also' && process.argv[i + 1]) outs.push(process.argv[i + 1]);
  }
  return outs;
}

const defaultIn = path.join(root, 'research/scopus/shortlists/2026-07-12_library_coarse.json');
const defaultOut = defaultIn;
const inPath = path.resolve(root, argValue('--in', defaultIn));
const outPath = path.resolve(root, argValue('--out', defaultOut));
const extraOuts = alsoOutputs().map((p) => path.resolve(root, p));

const payload = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const papers = payload.papers || [];
const extractedAt = new Date().toISOString();

const counters = {
  human_evaluation: 0,
  computational_only: 0,
  review_conceptual: 0,
  uncertain: 0,
  perception: 0,
  visual_source: 0,
  presentation: 0,
  scale: 0,
  response_protocol: 0,
  measurement_channel: 0,
  recruitment: 0,
  sample_size: 0,
  country: 0,
  region: 0,
  methods: 0,
  reporting: 0,
};

const enriched = papers.map((paper) => {
  const analysis_meta = extractAnalysisMeta(paper, { extractedAt });
  const flags = analysis_meta.coverage_flags || {};
  const scope = analysis_meta.analysis_scope || 'uncertain';
  if (counters[scope] != null) counters[scope] += 1;
  if (flags.perception) counters.perception += 1;
  if (flags.visual_source) counters.visual_source += 1;
  if (flags.presentation) counters.presentation += 1;
  if (flags.scale) counters.scale += 1;
  if (flags.response_protocol) counters.response_protocol += 1;
  if (flags.measurement_channel) counters.measurement_channel += 1;
  if (flags.recruitment) counters.recruitment += 1;
  if (flags.sample_size) counters.sample_size += 1;
  if (flags.country) counters.country += 1;
  if (flags.region) counters.region += 1;
  if (flags.methods) counters.methods += 1;
  if (flags.reporting) counters.reporting += 1;
  return { ...paper, analysis_meta };
});

const next = {
  ...payload,
  analysis: {
    extraction_version: EXTRACTION_VERSION,
    extracted_at: extractedAt,
    coverage: {
      total: enriched.length,
      ...counters,
    },
  },
  papers: enriched,
};

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${filePath} (${data.papers?.length || 0} papers, meta ${EXTRACTION_VERSION})`);
}

writeJson(outPath, next);
for (const extra of extraOuts) writeJson(extra, next);

console.log('Coverage:', next.analysis.coverage);
