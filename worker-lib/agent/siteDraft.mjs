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
 * The incoming config, with the stored page put back: a draft write can keep
 * the page or remove it, but only sp_scheme_import may change it.
 *
 * - spSite without its HTML (as survey_get_draft returns it), or with the
 *   stored HTML, keeps the stored page when it names the stored page (same
 *   spSite.id). The page's html, id and allowedHosts are always taken from
 *   storage, so a draft write cannot widen the hosts the page may load from.
 * - A config without spSite removes the page, as in the Builder.
 * - New or different page HTML is refused unless `replacePage` is set (the
 *   import, after its own check).
 * @throws 400 SITE_HTML_MISSING / SITE_HTML_CHANGED
 */
export function keepStoredSiteHtml(incoming, stored, { replacePage = false } = {}) {
  const site = incoming?.spSite;
  if (!site || typeof site !== 'object') return incoming;
  if (replacePage && typeof site.html === 'string' && site.html) return incoming;
  const storedSite = stored?.spSite;
  const storedHtml = typeof storedSite?.html === 'string' && storedSite.html ? storedSite.html : '';
  const sentHtml = typeof site.html === 'string' && site.html ? site.html : '';
  if (sentHtml && sentHtml !== storedHtml) {
    throw Object.assign(new Error(
      'The page (spSite.html) cannot be changed with a draft write. Call sp_scheme_import with the new page (and projectId) instead; keep spSite.id as survey_get_draft returned it to keep the current page.',
    ), { status: 400, code: 'SITE_HTML_CHANGED' });
  }
  // Here any HTML sent is the stored page itself.
  if (storedHtml && (sentHtml || (storedSite.id && site.id === storedSite.id))) {
    const { allowedHosts, ...rest } = site;
    void allowedHosts;
    return {
      ...incoming,
      spSite: {
        ...rest,
        id: storedSite.id,
        html: storedHtml,
        ...(storedSite.allowedHosts !== undefined ? { allowedHosts: storedSite.allowedHosts } : {}),
      },
    };
  }
  throw Object.assign(new Error(
    'spSite has no page HTML. Keep spSite.id as survey_get_draft returned it to keep the current page, remove spSite to remove the page, or call sp_scheme_import to change the page.',
  ), { status: 400, code: 'SITE_HTML_MISSING' });
}
