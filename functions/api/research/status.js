import { json } from '../../_lib/r2.js';

export const onRequestGet = async ({ env }) => {
  const hasS2 = Boolean(env.SEMANTIC_SCHOLAR_API_KEY);
  const hasMailto = Boolean(env.CROSSREF_MAILTO);
  return json({
    success: true,
    semanticScholarConfigured: hasS2,
    crossrefMailtoConfigured: hasMailto,
    note: hasS2
      ? 'Semantic Scholar API key present.'
      : 'SEMANTIC_SCHOLAR_API_KEY not set — unauthenticated S2 calls may be rate-limited.',
  });
};
