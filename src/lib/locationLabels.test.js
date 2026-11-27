import { facetLabel } from './templateFacets';

test('location names keep Taiwan, Hong Kong and mainland China apart', () => {
  expect(facetLabel('country', 'China', true)).toBe('中国内地');
  expect(facetLabel('country', 'China', false)).toBe('Mainland China');
  expect(facetLabel('country', 'Taiwan', true)).toBe('台湾');
  expect(facetLabel('country', 'Hong Kong', true)).toBe('香港');
  expect(facetLabel('country', 'Taiwan', false)).toBe('Taiwan');
  expect(facetLabel('country', 'Atlantis', true)).toBe('Atlantis');
});
