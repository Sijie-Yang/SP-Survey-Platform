/** Signed-in researchers open the workspace. Everyone else signs in first. */
export function researcherEntryPath(isAuthenticated) {
  return isAuthenticated ? '/admin' : '/login';
}

/** Keep in-app return paths. Reject protocol-relative and off-site targets. */
export function safeInAppPath(next, fallback = '/admin') {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
