import { json } from '../../_lib/r2.js';
import { searchBothProviders } from '../../_lib/researchProviders.js';

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    const { query, limit = 20, yearFrom = null, yearTo = null } = body || {};
    if (!query || !String(query).trim()) {
      return json({ success: false, error: 'query is required' }, { status: 400 });
    }
    const result = await searchBothProviders({
      query: String(query).trim(),
      limit: Number(limit) || 20,
      yearFrom: yearFrom == null || yearFrom === '' ? null : Number(yearFrom),
      yearTo: yearTo == null || yearTo === '' ? null : Number(yearTo),
      semanticScholarApiKey: env.SEMANTIC_SCHOLAR_API_KEY || '',
      crossrefMailto: env.CROSSREF_MAILTO || '',
    });
    return json({
      success: true,
      papers: result.papers,
      sourcesUsed: result.sourcesUsed,
      warnings: result.errors,
      count: result.papers.length,
    });
  } catch (error) {
    return json({
      success: false,
      error: error.message || String(error),
      errors: error.errors || [],
    }, { status: 502 });
  }
};
