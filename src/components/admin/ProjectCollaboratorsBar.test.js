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

test('owner opens the Chinese invite control from a toolbar circle', async () => {
  renderBar({ ownerUserId: 'owner', currentUserId: 'owner', accessRole: 'owner' });
  const presence = await screen.findByRole('button', { name: '林夏正在查看此项目' });
  expect(presence).toHaveTextContent('林');
  const invite = screen.getByRole('button', { name: '通过邮箱邀请协作者' });
  fireEvent.click(invite);
  expect(screen.getByLabelText('已有账号的邮箱')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('已有账号的邮箱'), { target: { value: 'new@example.com' } });
  addProjectCollaborator.mockResolvedValue({ userId: 'new', email: 'new@example.com', displayName: 'new' });
  fireEvent.click(screen.getByRole('button', { name: '添加协作者' }));
  await waitFor(() => expect(addProjectCollaborator).toHaveBeenCalledWith('proj_1', 'new@example.com'));
  expect(await screen.findByText('已添加 new@example.com')).toBeTruthy();
});

test('a collaborator sees presence circles but not the invite circle', async () => {
  touchProjectPresence.mockResolvedValue([
    { userId: 'owner', displayName: '周宁', email: 'owner@example.com', lastSeenAt: new Date().toISOString() },
  ]);
  renderBar({ ownerUserId: 'owner', currentUserId: 'lin', accessRole: 'collaborator' });
  expect(await screen.findByRole('button', { name: '周宁正在查看此项目' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '通过邮箱邀请协作者' })).toBeNull();
});

test('leaving the project clears presence', async () => {
  const view = renderBar({ ownerUserId: 'owner', currentUserId: 'owner' });
  await screen.findByRole('button', { name: '林夏正在查看此项目' });
  view.unmount();
  expect(clearProjectPresence).toHaveBeenCalledWith('proj_1');
});

test('English tooltips name who is online and what the invite circle does', async () => {
  localStorage.setItem('sp-survey-language', 'en');
  render(
    <RegionProvider>
      <ProjectCollaboratorsBar
        projectId="proj_1"
        ownerUserId="owner"
        currentUserId="owner"
        previewState={{
          collaborators: [],
          presence: [
            { userId: 'lin', displayName: 'Lin Xia', email: 'lin@example.com', lastSeenAt: new Date().toISOString() },
          ],
        }}
      />
    </RegionProvider>,
  );
  expect(screen.getByRole('button', { name: 'Lin Xia has this project open' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Invite a collaborator by email' })).toBeTruthy();
});

test('presence circles overlap with different colors and no text row', () => {
  touchProjectPresence.mockClear();
  renderBar({
    ownerUserId: 'owner',
    currentUserId: 'owner',
    previewState: {
      collaborators: [],
      presence: [
        { userId: 'lin', displayName: '林夏', email: 'lin@example.com', lastSeenAt: new Date().toISOString() },
        { userId: 'wei', displayName: '魏航', email: 'wei@example.com', lastSeenAt: new Date().toISOString() },
      ],
    },
  });
  const circles = screen.getAllByTestId('presence-circle');
  expect(circles).toHaveLength(2);
  expect(circles[1]).toHaveStyle({ marginLeft: '-10px' });
  expect(circles[0].getAttribute('data-color')).not.toBe(circles[1].getAttribute('data-color'));
  expect(screen.queryByText('也在此项目')).toBeNull();
  expect(touchProjectPresence).not.toHaveBeenCalled();
});
