/**
 * An imported SP-Scheme page (config.spSite.html) can be up to 3 MB. Agents
 * read and write the rest of the config, so draft reads leave the page out and
 * draft writes keep the stored page when the agent sends the config back.
 */

const SITE_HTML_NOTE = 'The page HTML is left out to keep this small. Use sp_scheme_import to replace the page; keep spSite.id unchanged in survey_replace_draft to keep it.';

function utf8Length(text) {
  return new TextEncoder().encode(String(text || '')).length;
}

/** The config with spSite.html replaced by `{ id, bytes, note }`. */
export function trimSiteHtml(config) {
  const site = config?.spSite;
  if (!site || typeof site !== 'object' || typeof site.html !== 'string') return config;
  return {
    ...config,
    spSite: { ...site, html: { id: site.id || null, bytes: utf8Length(site.html), note: SITE_HTML_NOTE } },
  };
}

/** A tool result with its `surveyConfig` trimmed (other fields unchanged). */
export function trimResultSiteHtml(result) {
  if (!result || typeof result !== 'object' || !result.surveyConfig) return result;
  return { ...result, surveyConfig: trimSiteHtml(result.surveyConfig) };
}

/**
 * The incoming config, with the stored page put back when the agent sent the
 * same page (same spSite.id) without its HTML (as survey_get_draft returns it).
 * A config without spSite removes the page, as in the Builder.
 * @throws 400 when spSite has no HTML and does not name the stored page
 */
export function keepStoredSiteHtml(incoming, stored) {
  const site = incoming?.spSite;
  if (!site || typeof site !== 'object') return incoming;
  if (typeof site.html === 'string' && site.html) return incoming;
  const storedSite = stored?.spSite;
  if (storedSite?.id && site.id === storedSite.id && typeof storedSite.html === 'string' && storedSite.html) {
    return { ...incoming, spSite: { ...site, html: storedSite.html } };
  }
  throw Object.assign(new Error(
    'spSite has no page HTML. Keep spSite.id as survey_get_draft returned it to keep the current page, remove spSite to remove the page, or call sp_scheme_import to change the page.',
  ), { status: 400, code: 'SITE_HTML_MISSING' });
}
