import {
  avatarColor,
  collaboratorErrorText,
  mergeAccessibleProjects,
  normalizeCollaboratorEmail,
  presenceInitials,
  projectInsertPayload,
  projectUpdatePayload,
  visiblePresence,
} from './projectCollaborators';

test('email must already look like an address', () => {
  expect(normalizeCollaboratorEmail('  Friend@Example.com ')).toBe('friend@example.com');
  expect(normalizeCollaboratorEmail('not-an-email')).toBe('');
  expect(normalizeCollaboratorEmail('')).toBe('');
});

test('shared projects are added beside owned ones and other projects stay out', () => {
  const merged = mergeAccessibleProjects(
    [{ id: 'owned', name: 'Mine' }],
    [{ id: 'shared', name: 'Theirs' }, { id: 'owned', name: 'Should not replace' }],
  );
  expect(merged.map((project) => [project.id, project.accessRole])).toEqual([
    ['owned', 'owner'],
    ['shared', 'collaborator'],
  ]);
  expect(merged.find((project) => project.id === 'owned').name).toBe('Mine');
});

test('a collaborator save replaces the draft and does not send user_id', () => {
  const first = projectUpdatePayload({
    name: 'Study',
    surveyConfig: { title: 'One', pages: [{ name: 'p' }] },
    now: '2026-10-08T00:00:00.000Z',
  });
  const second = projectUpdatePayload({
    name: 'Study',
    surveyConfig: { title: 'Two', pages: [{ name: 'p' }] },
    now: '2026-10-08T00:01:00.000Z',
  });
  expect(first).not.toHaveProperty('user_id');
  expect(second.survey_config).toEqual({ title: 'Two', pages: [{ name: 'p' }] });
  expect(second.survey_config_draft).toEqual(second.survey_config);
  const inserted = projectInsertPayload(first, { id: 'proj_new', userId: 'owner-1' });
  expect(inserted.user_id).toBe('owner-1');
  expect(inserted.id).toBe('proj_new');
});

test('presence keeps other people seen recently and drops self and stale rows', () => {
  const now = Date.parse('2026-10-08T00:01:00.000Z');
  const rows = visiblePresence([
    { userId: 'self', displayName: 'Me', lastSeenAt: '2026-10-08T00:00:50.000Z' },
    { userId: 'lin', displayName: '林夏', lastSeenAt: '2026-10-08T00:00:40.000Z' },
    { userId: 'old', displayName: 'Old', lastSeenAt: '2026-10-08T00:00:00.000Z' },
  ], 'self', now, 30000);
  expect(rows.map((row) => row.userId)).toEqual(['lin']);
});

test('avatar label and known invite errors', () => {
  expect(presenceInitials('林夏', 'lin@example.com')).toBe('林');
  expect(presenceInitials('Lin Xia', 'lin@example.com')).toBe('LX');
  expect(avatarColor('lin')).toMatch(/^#/);
  const t = {
    collaboratorNoAccount: '没有账号',
    collaboratorMigrationMissing: '请执行 SQL',
  };
  expect(collaboratorErrorText(new Error('no account for that email'), t)).toBe('没有账号');
  expect(collaboratorErrorText(new Error('Could not find the function public.add_project_collaborator'), t)).toBe('请执行 SQL');
});
