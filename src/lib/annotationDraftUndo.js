import { normalizeAnnotationTool } from './annotationTools';

/**
 * Remove the last vertex of an in-progress polygon.
 * Returns null when no points remain. Non-polygon drafts are unchanged.
 */
export function popPolygonDraftPoint(draft) {
  if (!draft || normalizeAnnotationTool(draft.tool) !== 'polygon') return draft;
  const points = Array.isArray(draft.points) ? draft.points : [];
  if (points.length <= 1) return null;
  return { ...draft, points: points.slice(0, -1) };
}
