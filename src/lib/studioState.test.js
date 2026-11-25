import { classicEditorPath, forgetClassicEditingState, studioPath } from './studioState';

afterEach(() => sessionStorage.clear());

test('after a Studio write the classic editor forgets only that project\'s working copy', () => {
  sessionStorage.setItem('project_editing_states', JSON.stringify({ p1: { surveyConfig: { old: true } }, p2: { surveyConfig: {} } }));
  forgetClassicEditingState('p1');
  expect(JSON.parse(sessionStorage.getItem('project_editing_states'))).toEqual({ p2: { surveyConfig: {} } });
  forgetClassicEditingState('missing');
  forgetClassicEditingState('');
  expect(Object.keys(JSON.parse(sessionStorage.getItem('project_editing_states')))).toEqual(['p2']);
});

test('broken stored state is left alone', () => {
  sessionStorage.setItem('project_editing_states', '{not json');
  expect(() => forgetClassicEditingState('p1')).not.toThrow();
});

test('links to the classic editor and to Studio', () => {
  expect(classicEditorPath('proj_1')).toBe('/admin?project=proj_1');
  expect(classicEditorPath('proj_1', 'media')).toBe('/admin?project=proj_1&tab=media');
  expect(classicEditorPath('proj_1', 'nope')).toBe('/admin?project=proj_1');
  expect(classicEditorPath('')).toBe('/admin');
  expect(studioPath()).toBe('/studio');
  expect(studioPath('proj_1')).toBe('/studio/proj_1');
});
