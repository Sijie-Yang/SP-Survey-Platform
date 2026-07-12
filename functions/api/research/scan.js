import { json } from '../../_lib/r2.js';
import {
  PRESET_QUERIES,
  searchBothProviders,
  mergeCandidates,
} from '../../_lib/researchProviders.js';

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    const {
      preset = 'streetscape_perception',
      query: customQuery = null,
      limit = 15,
      yearFrom = null,
      yearTo = null,
      mode = 'latest',
    } = body || {};

    const queries = customQuery
      ? [String(customQuery).trim()]
      : (preset === 'all'
        ? Object.values(PRESET_QUERIES)
        : [PRESET_QUERIES[preset] || PRESET_QUERIES.streetscape_perception]);

    let yFrom = yearFrom == null || yearFrom === '' ? null : Number(yearFrom);
    let yTo = yearTo == null || yearTo === '' ? null : Number(yearTo);
    const nowY = new Date().getFullYear();
    if (mode === 'latest' && yFrom == null) yFrom = nowY - 5;
    if (mode === 'classic' && yTo == null) yTo = nowY - 6;

    const allPapers = [];
    const sourcesUsed = new Set();
    const warnings = [];
    const providerOpts = {
      semanticScholarApiKey: env.SEMANTIC_SCHOLAR_API_KEY || '',
      crossrefMailto: env.CROSSREF_MAILTO || '',
    };

    for (const q of queries) {
      try {
        const result = await searchBothProviders({
          query: q,
          limit: Number(limit) || 15,
          yearFrom: yFrom,
          yearTo: yTo,
          ...providerOpts,
        });
        allPapers.push(...result.papers);
        result.sourcesUsed.forEach((s) => sourcesUsed.add(s));
        warnings.push(...(result.errors || []));
      } catch (err) {
        warnings.push(`${q}: ${err.message}`);
      }
    }

    const papers = mergeCandidates([allPapers]);
    return json({
      success: true,
      papers,
      sourcesUsed: [...sourcesUsed],
      warnings,
      count: papers.length,
      queries,
      yearFrom: yFrom,
      yearTo: yTo,
      mode,
      preset,
    });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 502 });
  }
};
