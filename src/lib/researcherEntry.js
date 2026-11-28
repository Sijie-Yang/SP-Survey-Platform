/** The researcher workspace: Studio. The classic editor stays at /admin. */
export const WORKSPACE_PATH = '/studio';

/** Signed-in researchers open the workspace. Everyone else signs in first. */
export function researcherEntryPath(isAuthenticated) {
  return isAuthenticated ? WORKSPACE_PATH : '/login';
}

/** Keep in-app return paths. Reject protocol-relative and off-site targets. */
export function safeInAppPath(next, fallback = WORKSPACE_PATH) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}

/** The classic editor, whose sidebar lists the paper templates. */
export const TEMPLATES_PATH = '/admin';

/** The public template library (browse, try a template with ?preview=<id>). */
export const TEMPLATE_LIBRARY_PATH = '/templates';

/** The simple workspace's new-study screen, starting from this template. */
export function studioTemplatePath(templateId) {
  return `${WORKSPACE_PATH}?template=${encodeURIComponent(templateId)}`;
}

/**
 * Where "Use" on a template goes, after signing in when needed: the new-study
 * screen with that template chosen (the classic editor when no template is named).
 */
export function templateUsePath(isAuthenticated, templateId = '') {
  const target = templateId ? studioTemplatePath(templateId) : TEMPLATES_PATH;
  return isAuthenticated ? target : `/login?next=${encodeURIComponent(target)}`;
}

/** The sign-in page, coming back to this address (path and query) afterwards. */
export function loginRedirectPath(location) {
  const here = `${location?.pathname || ''}${location?.search || ''}`;
  const next = safeInAppPath(here, '');
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
