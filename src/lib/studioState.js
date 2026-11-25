/**
 * Studio and the classic editor share one project. The classic editor keeps a
 * per-tab working copy in sessionStorage (`project_editing_states`); after
 * Studio writes a project that copy is stale, so Studio drops it and the
 * classic editor loads the saved draft instead.
 */

const EDITING_STATES_KEY = 'project_editing_states';

/** Forget the classic editor's working copy of this project (no-op when there is none). */
export function forgetClassicEditingState(projectId) {
  if (!projectId) return;
  try {
    const raw = sessionStorage.getItem(EDITING_STATES_KEY);
    if (!raw) return;
    const states = JSON.parse(raw);
    if (!states || typeof states !== 'object' || !Object.prototype.hasOwnProperty.call(states, projectId)) return;
    delete states[projectId];
    sessionStorage.setItem(EDITING_STATES_KEY, JSON.stringify(states));
  } catch {
    // Storage unavailable or unreadable: nothing to forget.
  }
}

const CLASSIC_TABS = new Set(['media', 'builder', 'share', 'results']);

/** The classic editor opened on one project (and optionally one tab). */
export function classicEditorPath(projectId, tab = '') {
  if (!projectId) return '/admin';
  const params = new URLSearchParams({ project: projectId });
  if (CLASSIC_TABS.has(tab)) params.set('tab', tab);
  return `/admin?${params.toString()}`;
}

/** Studio's own page for a project. */
export function studioPath(projectId = '') {
  return projectId ? `/studio/${encodeURIComponent(projectId)}` : '/studio';
}
