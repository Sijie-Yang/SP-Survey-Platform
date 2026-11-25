import { WORKSPACE_PATH, researcherEntryPath, safeInAppPath } from './researcherEntry';

test('a signed-in researcher opens Studio instead of the login form', () => {
  expect(WORKSPACE_PATH).toBe('/studio');
  expect(researcherEntryPath(true)).toBe('/studio');
  expect(researcherEntryPath(false)).toBe('/login');
});

test('return paths stay inside the site and fall back to Studio', () => {
  expect(safeInAppPath('/admin')).toBe('/admin');
  expect(safeInAppPath('/skills?x=1')).toBe('/skills?x=1');
  expect(safeInAppPath('https://evil.example')).toBe('/studio');
  expect(safeInAppPath('//evil.example')).toBe('/studio');
  expect(safeInAppPath('')).toBe('/studio');
});
