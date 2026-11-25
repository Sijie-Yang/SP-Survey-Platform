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
