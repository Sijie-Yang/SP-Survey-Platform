/* eslint-disable import/first -- Jest mocks must be declared before the imports they replace. */
// CRA's Jest resolver predates package exports; use the same v7 router's CJS entry.
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

jest.mock('./lib/projectManager', () => ({
  migrateExistingConfig: jest.fn(() => Promise.resolve(null)),
  getActiveProject: jest.fn(),
  setActiveProject: jest.fn(),
  clearActiveProject: jest.fn(),
  saveProjectDraftOptimistic: jest.fn(),
  saveProjectFull: jest.fn(() => Promise.resolve({ success: true, draftUpdatedAt: '2026-11-25T00:00:00Z' })),
  getProjectById: jest.fn(),
  getProjectDraftStamp: jest.fn(),
}));
jest.mock('./lib/surveyStorage', () => ({ loadSurveyConfig: jest.fn() }));
jest.mock('./lib/supabase', () => ({ supabase: null, isSupabaseConfigured: jest.fn(() => false) }));
jest.mock('./lib/templateManager', () => ({ checkIsAdmin: () => Promise.resolve(false) }));
jest.mock('./lib/featureFlags', () => ({
  isAssistantEnabled: () => false,
  isSiliconExperimentalEnabled: () => false,
}));
jest.mock('./contexts/AuthContext', () => ({ useAuth: () => ({ user: null, logout: jest.fn() }) }));
jest.mock('./hooks/useSurveyAssistant', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('./hooks/useSiliconTasks', () => ({ useSiliconTasks: () => ({ active: [], activeCount: 0 }) }));
jest.mock('./hooks/useCollectingSurveyCount', () => ({ useCollectingSurveyCount: () => 0 }));
jest.mock('./components/admin/ProjectSidebar', () => ({ __esModule: true, default: () => null }));
jest.mock('./components/admin/ProjectCollaboratorsBar', () => ({ __esModule: true, default: () => null }));
jest.mock('./components/admin/BackendStatus', () => ({ __esModule: true, default: () => null }));
jest.mock('./components/admin/AiAssistantSidebar', () => ({ __esModule: true, default: () => null }));
jest.mock('./components/admin/ProjectSurveyAge', () => ({
  __esModule: true,
  default: ({ project }) => <span>{project?.name}</span>,
}));
jest.mock('./components/admin/AdminIntroduction', () => ({
  __esModule: true,
  default: ({ surveyConfig }) => <div data-testid="intro-config">{surveyConfig?.title}</div>,
}));
jest.mock('./components/admin/ImageDataset', () => ({
  __esModule: true,
  default: () => <div data-testid="media-tab">media</div>,
}));
jest.mock('./components/admin/SurveyBuilder', () => ({
  __esModule: true,
  default: ({ config }) => <div data-testid="builder-config">{config?.title}</div>,
}));
jest.mock('./components/admin/WebsiteSetup', () => ({ __esModule: true, default: () => <div>share</div> }));
jest.mock('./components/admin/ResultsAnalysis', () => ({ __esModule: true, default: () => <div>results</div> }));
jest.mock('./components/admin/ResearcherPractice', () => ({ __esModule: true, default: () => null }));
jest.mock('./components/admin/SiliconSamples', () => ({ __esModule: true, default: () => null }));
jest.mock('./components/admin/SurveyPreview', () => ({ __esModule: true, default: () => null }));
jest.mock('./components/admin/FullSurveyPreview', () => ({ __esModule: true, default: () => null }));

import React from 'react';
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { RegionProvider } from './contexts/RegionContext';
import AdminApp from './AdminApp';
import * as mockProjectManager from './lib/projectManager';
import { loadSurveyConfig as mockLoadSurveyConfig } from './lib/surveyStorage';
import { isSupabaseConfigured as mockIsSupabaseConfigured } from './lib/supabase';

const PROJECT = { id: 'proj_1', name: 'Street study', userId: 'u1', _surveyConfig: { title: 'Stored draft' } };

function openAdmin(path) {
  localStorage.setItem('sp-survey-language', 'en');
  const router = createMemoryRouter([
    { path: '/', element: <div>home page</div> },
    { path: '/admin', element: <AdminApp /> },
    { path: '/studio/:projectId', element: <div>studio page</div> },
  ], { initialEntries: [path] });
  render(<RegionProvider><RouterProvider router={router} /></RegionProvider>);
  return router;
}

function rememberEditingState(state) {
  sessionStorage.setItem('project_editing_states', JSON.stringify({ proj_1: state }));
}

beforeAll(() => {
  // jsdom has no layout; the tab strip scrolls its selected tab into view.
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  mockProjectManager.getActiveProject.mockResolvedValue(PROJECT);
  mockProjectManager.saveProjectFull.mockResolvedValue({ success: true, draftUpdatedAt: '2026-11-25T00:00:00Z' });
  mockIsSupabaseConfigured.mockReturnValue(false);
  mockLoadSurveyConfig.mockResolvedValue({ title: 'Stored draft', pages: [] });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  delete global.fetch;
});

test('a clean cached copy does not replace the stored draft on startup', async () => {
  rememberEditingState({
    surveyConfig: { title: 'Old cached copy' },
    lastSavedConfig: { title: 'Old cached copy' },
    hasUnsavedChanges: false,
    tabValue: 0,
    tabsVersion: 2,
  });
  openAdmin('/admin');
  expect(await screen.findByTestId('intro-config')).toHaveTextContent('Stored draft');
  expect(mockLoadSurveyConfig).toHaveBeenCalledWith('proj_1');
});

test('a cached copy with unsaved edits is still restored on startup', async () => {
  rememberEditingState({
    surveyConfig: { title: 'Unsaved edit' },
    lastSavedConfig: { title: 'Stored draft' },
    hasUnsavedChanges: true,
    tabValue: 2,
    tabsVersion: 2,
  });
  openAdmin('/admin');
  expect(await screen.findByTestId('builder-config')).toHaveTextContent('Unsaved edit');
  expect(mockLoadSurveyConfig).not.toHaveBeenCalled();
});

test('the remembered tab survives a clean startup', async () => {
  rememberEditingState({
    surveyConfig: { title: 'Old cached copy' },
    lastSavedConfig: { title: 'Old cached copy' },
    hasUnsavedChanges: false,
    tabValue: 2,
    tabsVersion: 2,
  });
  openAdmin('/admin');
  expect(await screen.findByTestId('builder-config')).toHaveTextContent('Stored draft');
});

test('/admin?project=<id>&tab=media opens that project on the media tab and cleans the address', async () => {
  const router = openAdmin('/admin?project=proj_1&tab=media');
  expect(mockProjectManager.setActiveProject).toHaveBeenCalledWith('proj_1');
  expect(await screen.findByTestId('media-tab')).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.search).toBe(''));
  expect(router.state.location.pathname).toBe('/admin');
  expect(router.state.location.state).toEqual(expect.objectContaining({ adminTab: 1 }));
  expect(mockProjectManager.setActiveProject.mock.invocationCallOrder[0])
    .toBeLessThan(mockProjectManager.getActiveProject.mock.invocationCallOrder[0]);
});

test('an unusable project id is not made active', async () => {
  const router = openAdmin('/admin?project=..%2Fx');
  expect(await screen.findByTestId('intro-config')).toBeInTheDocument();
  expect(mockProjectManager.setActiveProject).not.toHaveBeenCalled();
  await waitFor(() => expect(router.state.location.search).toBe(''));
});

test('the top bar uses the paper look and opens Studio for the current project', async () => {
  const router = openAdmin('/admin');
  await screen.findByTestId('intro-config');
  expect(screen.getByAltText('SP-Survey')).toHaveAttribute('src', '/logo-web-header.png');
  expect(screen.getByTestId('admin-logo-home')).toHaveAttribute('href', '/');
  expect(screen.queryByTestId('admin-main-page')).not.toBeInTheDocument();
  await act(async () => { screen.getByTestId('admin-studio').click(); });
  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/proj_1'));
});

const UNSAVED_EDIT = {
  surveyConfig: { title: 'Unsaved edit' },
  lastSavedConfig: { title: 'Stored draft' },
  hasUnsavedChanges: true,
  tabValue: 2,
  tabsVersion: 2,
};

test('the logo saves unsaved edits before it leaves the editor', async () => {
  rememberEditingState(UNSAVED_EDIT);
  const router = openAdmin('/admin');
  await screen.findByTestId('builder-config');
  await act(async () => { screen.getByTestId('admin-logo-home').click(); });
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  expect(mockProjectManager.saveProjectFull).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'proj_1' }),
    expect.objectContaining({ title: 'Unsaved edit' }),
  );
});

test('the logo stays on the editor when the save fails', async () => {
  rememberEditingState(UNSAVED_EDIT);
  mockProjectManager.saveProjectFull.mockResolvedValue({ success: false, error: 'offline' });
  const router = openAdmin('/admin');
  await screen.findByTestId('builder-config');
  await act(async () => { screen.getByTestId('admin-logo-home').click(); });
  expect(await screen.findByText('Your latest changes are not saved yet. Save them, then leave.')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/admin');
});

test('Studio waits for a save that is already running instead of warning', async () => {
  rememberEditingState(UNSAVED_EDIT);
  let finishSave;
  mockProjectManager.saveProjectFull.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
  const router = openAdmin('/admin');
  await screen.findByTestId('builder-config');
  await act(async () => { screen.getByRole('button', { name: 'Save draft changes' }).click(); });
  expect(mockProjectManager.saveProjectFull).toHaveBeenCalledTimes(1);
  await act(async () => { screen.getByTestId('admin-studio').click(); });
  expect(router.state.location.pathname).toBe('/admin');
  await act(async () => { finishSave({ success: true, draftUpdatedAt: '2026-11-25T00:00:01Z' }); });
  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/proj_1'));
  expect(screen.queryByText(/not saved yet/)).not.toBeInTheDocument();
  expect(mockProjectManager.saveProjectFull).toHaveBeenCalledTimes(1);
});

test('on the platform a link to someone else\'s project does not open it', async () => {
  mockIsSupabaseConfigured.mockReturnValue(true);
  // The participant view returns the project without an owner.
  mockProjectManager.getActiveProject.mockResolvedValue({ ...PROJECT, userId: null });
  openAdmin('/admin?project=proj_1&tab=media');
  expect(await screen.findByText(/This project could not be opened/)).toBeInTheDocument();
  expect(screen.queryByTestId('media-tab')).not.toBeInTheDocument();
  expect(mockProjectManager.clearActiveProject).toHaveBeenCalled();
});
