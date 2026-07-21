/**
 * Annotation drawing tools. Canonical id is `polygon` (legacy `region` still accepted).
 */

export const ANNOTATION_TOOLS = ['point', 'line', 'polygon', 'bbox'];

const TOOL_LABELS = {
  point: 'Point',
  line: 'Line',
  polygon: 'Polygon',
  bbox: 'Bounding box',
};

/** Map legacy / alias ids → canonical tool id. */
export function normalizeAnnotationTool(tool) {
  if (tool == null || tool === '') return '';
  const t = String(tool).toLowerCase().trim();
  if (t === 'region' || t === 'poly' || t === 'polygon') return 'polygon';
  if (t === 'rect' || t === 'box' || t === 'bbox') return 'bbox';
  if (t === 'point' || t === 'line') return t;
  return t;
}

export function annotationToolLabel(tool) {
  const t = normalizeAnnotationTool(tool);
  return TOOL_LABELS[t] || t || '(unknown)';
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

export function isPolygonTool(tool) {
  return normalizeAnnotationTool(tool) === 'polygon';
}

/** Infer canonical tool from a stored shape (supports legacy `region`). */
export function inferShapeTool(shape) {
  if (shape?.tool) return normalizeAnnotationTool(shape.tool) || 'point';
  const n = shape?.points?.length || 0;
  if (n >= 3) return 'polygon';
  if (n === 2) return 'line';
  return 'point';
}
