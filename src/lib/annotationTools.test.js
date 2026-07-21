import {
  normalizeAnnotationTool,
  normalizeAllowedTools,
  inferShapeTool,
  annotationToolLabel,
} from './annotationTools';

describe('annotationTools', () => {
  test('normalizes legacy region → polygon', () => {
    expect(normalizeAnnotationTool('region')).toBe('polygon');
    expect(normalizeAnnotationTool('polygon')).toBe('polygon');
    expect(annotationToolLabel('region')).toBe('Polygon');
  });

  test('normalizes allowedTools list and dedupes', () => {
    expect(normalizeAllowedTools(['point', 'region', 'polygon', 'bbox'])).toEqual([
      'point', 'polygon', 'bbox',
    ]);
  });

  test('inferShapeTool reads stored tool and falls back by point count', () => {
    expect(inferShapeTool({ tool: 'region', points: [] })).toBe('polygon');
    expect(inferShapeTool({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] })).toBe('polygon');
    expect(inferShapeTool({ points: [{ x: 0, y: 0 }] })).toBe('point');
  });
});
