import { WORKSPACE_PATH, loginRedirectPath, researcherEntryPath, safeInAppPath, studioTemplatePath, templateUsePath } from './researcherEntry';

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

test('"Use" on a template opens the new-study screen with that template, signing in first when needed', () => {
  expect(templateUsePath(true, '2023-shen-design')).toBe('/studio?template=2023-shen-design');
  expect(templateUsePath(false, '2023-shen-design')).toBe('/login?next=%2Fstudio%3Ftemplate%3D2023-shen-design');
  expect(safeInAppPath(decodeURIComponent(templateUsePath(false, '2023-shen-design').split('next=')[1]))).toBe('/studio?template=2023-shen-design');
  expect(studioTemplatePath('a b')).toBe('/studio?template=a%20b');
  // Without a template: the classic editor, whose sidebar lists the templates.
  expect(templateUsePath(true)).toBe('/admin');
  expect(templateUsePath(false)).toBe('/login?next=%2Fadmin');
});

test('signing in comes back to the address that asked for it', () => {
  expect(loginRedirectPath({ pathname: '/studio/proj_1', search: '' })).toBe('/login?next=%2Fstudio%2Fproj_1');
  expect(loginRedirectPath({ pathname: '/admin', search: '?project=proj_1&tab=media' }))
    .toBe(`/login?next=${encodeURIComponent('/admin?project=proj_1&tab=media')}`);
  expect(loginRedirectPath({ pathname: '//evil.example', search: '' })).toBe('/login');
  expect(loginRedirectPath(null)).toBe('/login');
});
