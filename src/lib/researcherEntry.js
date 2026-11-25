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

/** Where "Use" on a template goes: the classic editor, after signing in when needed. */
export function templateUsePath(isAuthenticated) {
  return isAuthenticated ? TEMPLATES_PATH : `/login?next=${encodeURIComponent(TEMPLATES_PATH)}`;
}

/** The sign-in page, coming back to this address (path and query) afterwards. */
export function loginRedirectPath(location) {
  const here = `${location?.pathname || ''}${location?.search || ''}`;
  const next = safeInAppPath(here, '');
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
