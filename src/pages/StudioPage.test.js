/* eslint-disable import/first -- Jest mocks must be declared before the router import. */
jest.mock('react-router-dom', () => {
  // The router needs TextEncoder. Its bytes must be this window's Uint8Array, or
  // fflate (which builds the example zip) mistakes them for a folder.
  const { TextEncoder: NodeTextEncoder } = require('util');
  global.TextEncoder = class TextEncoder {
    encode(text) { return new Uint8Array(new NodeTextEncoder().encode(text)); }
  };
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

jest.mock('../contexts/AuthContext', () => {
  const auth = { user: { id: 'u1' }, isAuthenticated: true, loading: false };
  return { useAuth: () => auth, useOptionalAuth: () => auth };
});
jest.mock('../components/layout/PublicHeader', () => ({ __esModule: true, default: () => null, PublicFooter: () => null }));
jest.mock('../components/StreetscapeAtmosphere', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/admin/SurveyPreview', () => ({ __esModule: true, default: ({ viewport }) => <div data-testid="survey-preview">preview {viewport}</div> }));
jest.mock('../lib/projectManager', () => ({ setActiveProject: jest.fn(), setProjectPublicSlug: jest.fn() }));
jest.mock('../lib/r2', () => ({ uploadImageToR2: jest.fn(), deleteImagesFromR2: jest.fn() }));
jest.mock('../lib/studioData', () => ({
  isStudioLocalMode: jest.fn(),
  listStudioProjects: jest.fn(),
  loadStudioProject: jest.fn(),
  saveStudioProject: jest.fn(),
  updateStudioProject: jest.fn(),
  createStudioProject: jest.fn(),
  removeStudioProject: jest.fn(),
  countStudioResponses: jest.fn(),
  publishStudioProject: jest.fn(),
}));

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { RegionProvider } from '../contexts/RegionContext';
import StudioPage from './StudioPage';
import { buildExampleSite } from '../lib/spScheme';
import { LEGACY_SURVEY_HTML } from '../lib/__fixtures__/legacySurvey';
import { setActiveProject } from '../lib/projectManager';
import { uploadImageToR2 } from '../lib/r2';
import {
  countStudioResponses,
  createStudioProject,
  isStudioLocalMode,
  listStudioProjects,
  loadStudioProject,
  publishStudioProject,
  saveStudioProject,
  updateStudioProject,
} from '../lib/studioData';

function ClassicStub() {
  const location = useLocation();
  return <div data-testid="classic-editor">{location.search}</div>;
}

function setDesktop(desktop) {
  window.matchMedia = (query) => ({
    matches: desktop && /min-width/.test(query),
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function openAt(path) {
  localStorage.setItem('sp-survey-language', 'en');
  const router = createMemoryRouter([
    { path: '/studio', element: <StudioPage /> },
    { path: '/studio/:projectId', element: <StudioPage /> },
    { path: '/admin', element: <ClassicStub /> },
  ], { initialEntries: [path] });
  render(<RegionProvider><RouterProvider router={router} /></RegionProvider>);
  return router;
}

const examplePage = { pages: [], spSite: { html: buildExampleSite(), id: 'site-1' } };
const classicConfig = { pages: [{ name: 'p', elements: [{ type: 'text', name: 'q1', title: 'Your name' }] }] };

function project(overrides = {}) {
  return {
    id: 'p1',
    userId: 'u1',
    name: 'Street perception study',
    description: '',
    preloadedImages: [],
    imageDatasetConfig: {},
    releaseManaged: false,
    publishedVersion: 0,
    lastModified: new Date().toISOString(),
    _surveyConfig: examplePage,
    ...overrides,
  };
}

beforeEach(() => {
  setDesktop(true);
  isStudioLocalMode.mockReturnValue(false);
  listStudioProjects.mockResolvedValue([project(), project({ id: 'p2', name: 'Classic one', _surveyConfig: classicConfig })]);
  loadStudioProject.mockImplementation(async (id) => (id === 'p2' ? project({ id: 'p2', name: 'Classic one', _surveyConfig: classicConfig }) : project()));
  saveStudioProject.mockResolvedValue({ success: true });
  updateStudioProject.mockResolvedValue({ success: true });
  createStudioProject.mockResolvedValue({ success: true, project: { id: 'p1', name: 'Street perception study' }, surveyConfig: { pages: [] } });
  countStudioResponses.mockResolvedValue(0);
  publishStudioProject.mockResolvedValue({ success: true, publishedVersion: 1 });
  uploadImageToR2.mockImplementation(async (file, key) => ({ success: true, url: `https://media.test/${key}`, key }));
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('the new-study screen offers the AI page and the classic editor as equal choices', async () => {
  openAt('/studio');
  expect(screen.getByRole('heading', { name: 'What are we researching today?' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Let AI make the survey' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Build it question by question' })).toBeInTheDocument();
  expect(screen.getByText('Drop the survey your AI built here')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy the instructions for your AI' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start from the example' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create and open the classic editor' })).toBeInTheDocument();
  const list = await screen.findByTestId('studio-project-list');
  expect(within(list).getByText('Street perception study')).toBeInTheDocument();
  expect(within(list).getAllByText('Draft')).toHaveLength(2);
  expect(screen.getByRole('link', { name: /Classic editor/ })).toHaveAttribute('href', '/admin');
});

test('copying the instructions puts SP-Scheme on the clipboard', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  openAt('/studio');
  fireEvent.click(screen.getByRole('button', { name: 'Copy the instructions for your AI' }));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(writeText.mock.calls[0][0]).toContain('SPSite.answer');
});

test('starting from the example imports it as a new study and opens it', async () => {
  const router = openAt('/studio');
  fireEvent.click(screen.getByRole('button', { name: 'Start from the example' }));
  expect(await screen.findByTestId('studio-import-verdict')).toHaveTextContent('Matches SP-Scheme: the platform records and analyses 3 question(s).');
  expect(screen.queryByTestId('studio-import-hosts')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/p1'));
  expect(createStudioProject).toHaveBeenCalledWith('Street perception study');
  expect(saveStudioProject).toHaveBeenCalledTimes(1);
  expect(saveStudioProject.mock.calls[0][1].spSite.html).toContain('SPSite.onReady');
  expect(await screen.findByTestId('studio-project-name')).toHaveTextContent('Street perception study');
});

test('a page that is not SP-Scheme says it is imported as it is, with what the AI can fix and the sites it uses', async () => {
  openAt('/studio');
  const broken = LEGACY_SURVEY_HTML.replace('<head>', '<head><script id="sp-scheme" type="application/json">{"format":"sp-scheme-package","spScheme":"2.0","survey":{"pages":[{"name":"p","elements":[{"type":"imagepicker","name":"q","choices":[{"value":"a","imageLink":"https://x.org/a.jpg"}]}]}]}}</script>');
  fireEvent.change(screen.getByTestId('studio-file'), { target: { files: [new File([broken], 'survey.html', { type: 'text/html' })] } });
  expect(await screen.findByTestId('studio-import-verdict')).toHaveTextContent('Not fully SP-Scheme, so it is imported as it is');
  expect(screen.getByTestId('studio-import-problems')).toHaveTextContent(/media URLs are not allowed/);
  expect(screen.getByRole('button', { name: 'Copy the instructions and these problems for your AI' })).toBeInTheDocument();
  const hosts = screen.getByTestId('studio-import-hosts');
  expect(within(hosts).getByRole('checkbox', { name: /cdn\.legacy-lab\.org/ })).toBeChecked();
  expect(within(hosts).getByRole('checkbox', { name: /api\.legacy-lab\.org/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Drop the survey your AI built here')).toBeInTheDocument();
});

test('the classic choice creates a study and opens it in the classic editor', async () => {
  createStudioProject.mockResolvedValue({ success: true, project: { id: 'p7', name: 'New study' }, surveyConfig: {} });
  openAt('/studio');
  fireEvent.click(screen.getByRole('button', { name: 'Create and open the classic editor' }));
  expect(await screen.findByTestId('classic-editor')).toHaveTextContent('?project=p7');
  expect(createStudioProject).toHaveBeenCalledWith('New study');
  expect(setActiveProject).toHaveBeenCalledWith('p7');
});

test('a draft AI page offers to publish, replace the page and copy it for the AI', async () => {
  openAt('/studio/p1');
  expect(await screen.findByTestId('studio-project-name')).toHaveTextContent('Street perception study');
  expect(screen.getByText(/^AI page · 0 image folder\(s\)/)).toBeInTheDocument();
  expect(screen.getByTestId('studio-status')).toHaveTextContent('Draft, not published yet');
  expect(screen.getByRole('button', { name: 'Publish and get the link' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Use another page' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy for your AI to edit' })).toBeInTheDocument();
  expect(screen.getByTestId('studio-link')).toHaveTextContent('After you publish, the participant link and QR code appear here.');
  expect(await screen.findByText('No responses yet. After you publish, send the link to participants.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
  expect(screen.getByTestId('survey-preview')).toHaveTextContent('preview mobile');
});

test('publishing a draft releases it once and reloads the study', async () => {
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Publish and get the link' }));
  await waitFor(() => expect(publishStudioProject).toHaveBeenCalledWith('p1'));
  await waitFor(() => expect(loadStudioProject).toHaveBeenCalledTimes(2));
});

test('publishing stops with plain reasons when the page needs images that are not there', async () => {
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: { pages: [], spSite: { html: '<script>SPSite.getMedia("streets")</script>', id: 's' } } }));
  openAt('/studio/p1');
  expect(await screen.findByTestId('studio-missing-folder')).toHaveTextContent('The page uses the folder streets, but it has no images yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Publish and get the link' }));
  expect(await screen.findByTestId('studio-publish-problems')).toHaveTextContent('The page uses the folder streets, but it has no images yet. Upload images first.');
  expect(publishStudioProject).not.toHaveBeenCalled();
});

test('the database setup message appears when a page-only draft is refused', async () => {
  publishStudioProject.mockResolvedValue({ success: false, code: 'site-pages-sql', error: 'draft has no pages' });
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Publish and get the link' }));
  expect(await screen.findByTestId('studio-publish-problems')).toHaveTextContent('run supabase/release_site_pages.sql once in Supabase');
});

test('a published study shows its link; changes since show as waiting', async () => {
  const published = { releaseManaged: true, publishedVersion: 3, publishedAt: '2026-01-01T10:00:00Z', draftUpdatedAt: '2026-01-01T10:00:00Z', publicSlug: 'campus' };
  loadStudioProject.mockResolvedValue(project(published));
  countStudioResponses.mockResolvedValue(12);
  openAt('/studio/p1');
  expect(await screen.findByRole('button', { name: 'Published' })).toBeDisabled();
  expect(screen.getByTestId('studio-status')).toHaveTextContent('Published v3');
  expect(screen.getByTestId('studio-share-url')).toHaveTextContent(`${window.location.origin}/s/campus`);
  await waitFor(() => expect(screen.getByTestId('studio-response-count')).toHaveTextContent('12'));
  expect(screen.getByRole('button', { name: 'Download data' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View analysis' })).toBeInTheDocument();
  expect(screen.queryByTestId('studio-link-pending')).toBeNull();
});

test('a published study with newer changes offers a new version', async () => {
  loadStudioProject.mockResolvedValue(project({ releaseManaged: true, publishedVersion: 3, publishedAt: '2026-01-01T10:00:00Z', draftUpdatedAt: '2026-01-02T10:00:00Z' }));
  openAt('/studio/p1');
  expect(await screen.findByRole('button', { name: 'Publish new version' })).toBeEnabled();
  expect(screen.getByTestId('studio-status')).toHaveTextContent('Changes not published yet');
  expect(screen.getByTestId('studio-link-pending')).toHaveTextContent('Participants now see v3. Your changes take effect after you publish.');
});

test('a classic study is edited in the classic editor', async () => {
  openAt('/studio/p2');
  expect(await screen.findByText(/^Question by question/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use another page' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit in the classic editor' }));
  expect(await screen.findByTestId('classic-editor')).toHaveTextContent('?project=p2&tab=builder');
  expect(setActiveProject).toHaveBeenCalledWith('p2');
});

test('an empty study shows the drop zone right in the preview card', async () => {
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: { pages: [{ name: 'p', elements: [] }] } }));
  openAt('/studio/p1');
  const preview = await screen.findByTestId('studio-preview');
  expect(within(preview).getByText('Drop the survey your AI built here')).toBeInTheDocument();
  expect(within(preview).getByRole('button', { name: 'open the classic editor' })).toBeInTheDocument();
});

test('renaming saves when the field is left', async () => {
  openAt('/studio/p1');
  fireEvent.click(await screen.findByTestId('studio-project-name'));
  const input = screen.getByRole('textbox', { name: 'Study name' });
  fireEvent.change(input, { target: { value: 'Walkability' } });
  fireEvent.blur(input);
  await waitFor(() => expect(updateStudioProject).toHaveBeenCalledWith('p1', { name: 'Walkability' }));
  await waitFor(() => expect(loadStudioProject).toHaveBeenCalledTimes(2));
});

test('uploading images puts them in the chosen folder and saves the library', async () => {
  loadStudioProject.mockResolvedValue(project({ _surveyConfig: { pages: [], spSite: { html: '<script>SPSite.getMedia("streets")</script>', id: 's' } } }));
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Upload images' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('combobox', { name: 'Folder' })).toHaveValue('streets');
  fireEvent.change(within(dialog).getByTestId('studio-upload-files'), {
    target: { files: [new File([new Uint8Array([1, 2])], 'a.jpg', { type: 'image/jpeg' }), new File(['x'], 'notes.txt', { type: 'text/plain' })] },
  });
  expect(within(dialog).getByText(/1 file\(s\) selected\./)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(saveStudioProject).toHaveBeenCalledTimes(1));
  expect(uploadImageToR2.mock.calls[0][1]).toMatch(/^u1\/p1\/streets\/a__.+\.jpg$/);
  const [saved] = saveStudioProject.mock.calls[0];
  expect(saved.preloadedImages).toEqual([expect.objectContaining({ folder: 'streets', name: 'a.jpg' })]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(loadStudioProject).toHaveBeenCalledTimes(2));
});

test('the settings dialog saves the response limit into the survey', async () => {
  openAt('/studio/p1');
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  const limit = await screen.findByRole('spinbutton', { name: 'Response limit' });
  fireEvent.change(limit, { target: { value: '120' } });
  fireEvent.blur(limit);
  await waitFor(() => expect(saveStudioProject).toHaveBeenCalledTimes(1));
  expect(saveStudioProject.mock.calls[0][1].responseQuota).toBe(120);
  await waitFor(() => expect(loadStudioProject).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Delete this study' })).toBeInTheDocument();
});

test('local mode needs no publishing and links to the survey directly', async () => {
  isStudioLocalMode.mockReturnValue(true);
  openAt('/studio/p1');
  expect(await screen.findByTestId('studio-local-note')).toHaveTextContent('Local mode: saved changes are live right away.');
  expect(screen.queryByRole('button', { name: 'Publish and get the link' })).toBeNull();
  expect(screen.getByTestId('studio-share-url')).toHaveTextContent(`${window.location.origin}/survey?project=p1`);
});

test('on a phone the list of studies opens from a button', async () => {
  setDesktop(false);
  openAt('/studio');
  expect(screen.queryByTestId('studio-project-list')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'My studies' }));
  const list = await screen.findByTestId('studio-project-list');
  expect(within(list).getByText('Classic one')).toBeInTheDocument();
});
