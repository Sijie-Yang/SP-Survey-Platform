/**
 * Annotation drawing tools (Worker mirror of src/lib/annotationTools.js).
 */

export const ANNOTATION_TOOLS = ['point', 'line', 'polygon', 'bbox'];

/** Map legacy / alias ids → canonical tool id. */
export function normalizeAnnotationTool(tool) {
  if (tool == null || tool === '') return '';
  const t = String(tool).toLowerCase().trim();
  if (t === 'region' || t === 'poly' || t === 'polygon') return 'polygon';
  if (t === 'rect' || t === 'box' || t === 'bbox') return 'bbox';
  if (t === 'points' || t === 'point') return 'point';
  if (t === 'path' || t === 'polyline' || t === 'line') return 'line';
  return t;
}

export function normalizeAllowedTools(tools, fallback = ANNOTATION_TOOLS) {
  const src = Array.isArray(tools) && tools.length ? tools : fallback;
  const out = [];
  const seen = new Set();
  src.forEach((raw) => {
    const t = normalizeAnnotationTool(raw);
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out.length ? out : [...fallback];
}
