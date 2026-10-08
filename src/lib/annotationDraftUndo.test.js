import { popPolygonDraftPoint } from './annotationDraftUndo';

const point = (x, y) => ({ x, y });
const polygon = (...coords) => ({ tool: 'polygon', points: coords.map(([x, y]) => point(x, y)) });

test('undo removes only the last polygon vertex', () => {
  const draft = polygon([0.1, 0.2], [0.3, 0.4], [0.5, 0.6]);
  const next = popPolygonDraftPoint(draft);
  expect(next.points).toEqual([point(0.1, 0.2), point(0.3, 0.4)]);
  expect(draft.points).toHaveLength(3);
  expect(popPolygonDraftPoint(next).points).toEqual([point(0.1, 0.2)]);
});

test('undo of the last remaining vertex clears the polygon draft', () => {
  expect(popPolygonDraftPoint(polygon([0.2, 0.2]))).toBeNull();
  expect(popPolygonDraftPoint({ tool: 'region', points: [point(0.2, 0.2)] })).toBeNull();
});

test('line and box drafts stay intact so committed undo can still cancel them', () => {
  const line = { tool: 'line', points: [point(0, 0), point(1, 1)] };
  const box = { tool: 'bbox', points: [point(0, 0), point(1, 1)] };
  expect(popPolygonDraftPoint(line)).toBe(line);
  expect(popPolygonDraftPoint(box)).toBe(box);
  expect(popPolygonDraftPoint(null)).toBeNull();
});
