import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
import { checkIsAdmin, copyProjectToAdmin, listAllProjects } from '../lib/templateManager';
import { setActiveProject } from '../lib/projectManager';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock('../lib/supabase', () => ({ supabase: null }));
jest.mock('../lib/templateManager', () => ({
  ...jest.requireActual('../lib/templateManager'),
  checkIsAdmin: jest.fn(),
  listAllProjects: jest.fn(),
  copyProjectToAdmin: jest.fn(),
}));
jest.mock('../lib/projectManager', () => ({ setActiveProject: jest.fn() }));
jest.mock('../components/SiteGrowthSection', () => () => null);
jest.mock('../components/layout/AdminShell', () => ({ children }) => <div>{children}</div>);
jest.mock('../components/admin/SurveyBuilder', () => (props) => (
  <div data-testid="builder">{props.hideAssistant ? 'assistant hidden' : 'assistant shown'}</div>
));

const project = {
  id: 'proj_src', name: '儿童环境公平', description: '', user_id: 'owner', template_id: null,
  config: { pages: [] }, preloadedImages: [], imageDatasetConfig: {}, metadata: {},
  updated_at: '2026-10-28T00:00:00Z',
};
const copy = {
  ...project, id: 'proj_new', name: '儿童环境公平（副本）', user_id: 'admin',
  metadata: { copiedFrom: { projectId: 'proj_src', projectName: '儿童环境公平' } },
};

async function openProjects() {
  render(<AdminDashboard />);
  fireEvent.click(await screen.findByRole('tab', { name: '项目概览' }));
  await screen.findByText('儿童环境公平');
}

beforeEach(() => {
  checkIsAdmin.mockResolvedValue(true);
  listAllProjects.mockResolvedValue([project]);
});

test('admin 编辑调查内容 uses the Builder without the old inline AI Assistant', async () => {
  await openProjects();
  fireEvent.click(screen.getByRole('button', { name: '编辑调查内容' }));
  expect((await screen.findByTestId('builder')).textContent).toContain('assistant hidden');
});

test('复制项目 explains, copies into the admin account and opens the copy', async () => {
  copyProjectToAdmin.mockResolvedValue({
    success: true, project: { id: 'proj_new', name: '儿童环境公平（副本）' }, copiedMedia: 2, failedMedia: [],
  });
  await openProjects();
  fireEvent.click(screen.getByRole('button', { name: '复制项目：儿童环境公平' }));
  const dialog = await screen.findByRole('dialog');
  expect((dialog).textContent).toContain('儿童环境公平（副本）');
  expect((dialog).textContent).toContain('原项目不会有任何改动');
  expect((dialog).textContent).toContain('参与者的回答');
  expect(copyProjectToAdmin).not.toHaveBeenCalled();

  listAllProjects.mockResolvedValue([copy, project]);
  fireEvent.click(within(dialog).getByRole('button', { name: '复制' }));
  expect(await within(dialog).findByText(/已创建「儿童环境公平（副本）」/)).toBeTruthy();
  expect(copyProjectToAdmin).toHaveBeenCalledWith('proj_src', expect.any(Object));
  // The table refreshes and tags the copy.
  expect(await screen.findByText('副本')).toBeTruthy();

  fireEvent.click(within(dialog).getByRole('button', { name: '在 Builder 打开副本' }));
  expect(setActiveProject).toHaveBeenCalledWith('proj_new');
  expect(mockNavigate).toHaveBeenCalledWith('/admin');
});

test('a failed copy says the original is unchanged', async () => {
  copyProjectToAdmin.mockRejectedValue(new Error('permission denied'));
  await openProjects();
  fireEvent.click(screen.getByRole('button', { name: '复制项目：儿童环境公平' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '复制' }));
  expect(await screen.findByText(/复制失败：permission denied。原项目没有改动/)).toBeTruthy();
});
