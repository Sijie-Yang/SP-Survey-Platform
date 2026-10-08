import { researcherEntryPath, safeInAppPath } from './researcherEntry';

test('a signed-in researcher opens the workspace instead of the login form', () => {
  expect(researcherEntryPath(true)).toBe('/admin');
  expect(researcherEntryPath(false)).toBe('/login');
});

test('return paths stay inside the site', () => {
  expect(safeInAppPath('/admin')).toBe('/admin');
  expect(safeInAppPath('/skills?x=1')).toBe('/skills?x=1');
  expect(safeInAppPath('https://evil.example')).toBe('/admin');
  expect(safeInAppPath('//evil.example')).toBe('/admin');
  expect(safeInAppPath('')).toBe('/admin');
});
