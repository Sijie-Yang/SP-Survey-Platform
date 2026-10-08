import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectCollaboratorsBar from './ProjectCollaboratorsBar';
import { RegionProvider } from '../../contexts/RegionContext';
import { addProjectCollaborator, clearProjectPresence, listProjectCollaborators, touchProjectPresence } from '../../lib/projectCollaborators';

jest.mock('../../lib/projectCollaborators', () => {
  const actual = jest.requireActual('../../lib/projectCollaborators');
  return {
    ...actual,
    addProjectCollaborator: jest.fn(),
    removeProjectCollaborator: jest.fn(),
    listProjectCollaborators: jest.fn().mockResolvedValue([]),
    touchProjectPresence: jest.fn().mockResolvedValue([]),
    clearProjectPresence: jest.fn().mockResolvedValue(true),
  };
});

function renderBar(props) {
  localStorage.setItem('sp-survey-language', 'zh');
  return render(
    <RegionProvider>
      <ProjectCollaboratorsBar projectId="proj_1" {...props} />
    </RegionProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  listProjectCollaborators.mockResolvedValue([
    { userId: 'lin', email: 'lin@example.com', displayName: '林夏' },
  ]);
  touchProjectPresence.mockResolvedValue([
    { userId: 'lin', email: 'lin@example.com', displayName: '林夏', lastSeenAt: new Date().toISOString() },
  ]);
});

test('owner sees the Chinese invite control and who else is here', async () => {
  renderBar({ ownerUserId: 'owner', currentUserId: 'owner', accessRole: 'owner' });
  expect(await screen.findByText('林夏')).toBeTruthy();
  expect(screen.getByLabelText('已有账号的邮箱')).toBeTruthy();
  expect(screen.getByRole('button', { name: '添加协作者' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('已有账号的邮箱'), { target: { value: 'new@example.com' } });
  addProjectCollaborator.mockResolvedValue({ userId: 'new', email: 'new@example.com', displayName: 'new' });
  fireEvent.click(screen.getByRole('button', { name: '添加协作者' }));
  await waitFor(() => expect(addProjectCollaborator).toHaveBeenCalledWith('proj_1', 'new@example.com'));
  expect(await screen.findByText('已添加 new@example.com')).toBeTruthy();
});

test('a collaborator can see presence but cannot invite', async () => {
  touchProjectPresence.mockResolvedValue([
    { userId: 'owner', displayName: '周宁', email: 'owner@example.com', lastSeenAt: new Date().toISOString() },
  ]);
  renderBar({ ownerUserId: 'owner', currentUserId: 'lin', accessRole: 'collaborator' });
  expect(await screen.findByText('周宁')).toBeTruthy();
  expect(screen.getByText('lin@example.com')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '添加协作者' })).toBeNull();
});

test('leaving the project clears presence', async () => {
  const view = renderBar({ ownerUserId: 'owner', currentUserId: 'owner' });
  await screen.findByText('林夏');
  view.unmount();
  expect(clearProjectPresence).toHaveBeenCalledWith('proj_1');
});

test('preview state shows the presence row without a network call', () => {
  touchProjectPresence.mockClear();
  renderBar({
    ownerUserId: 'owner',
    currentUserId: 'owner',
    previewState: {
      collaborators: [],
      presence: [{ userId: 'lin', displayName: '林夏', email: 'lin@example.com', lastSeenAt: new Date().toISOString() }],
    },
  });
  expect(screen.getByText('也在此项目')).toBeTruthy();
  expect(screen.getByText('林夏')).toBeTruthy();
  expect(touchProjectPresence).not.toHaveBeenCalled();
});
