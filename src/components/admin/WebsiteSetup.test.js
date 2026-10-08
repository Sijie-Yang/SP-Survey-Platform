import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WebsiteSetup from './WebsiteSetup';
import { RegionProvider } from '../../contexts/RegionContext';
import { adminI18n } from '../../contexts/adminI18n';
import { setProjectPublicSlug } from '../../lib/projectManager';

jest.mock('../../lib/projectManager', () => ({
  setProjectPublicSlug: jest.fn(),
}));

const project = { id: 'proj_1', name: 'Campus', publicSlug: '', publishedVersion: 0 };

function renderShare(language = 'en') {
  localStorage.setItem('sp-survey-language', language);
  return render(
    <RegionProvider>
      <WebsiteSetup currentProject={project} surveyConfig={{ pages: [{ elements: [{ type: 'text', name: 'q1' }] }] }} />
    </RegionProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
  setProjectPublicSlug.mockReset();
});

test('share copy exists in English and Chinese', () => {
  ['shareCustomLink', 'shareCustomLinkTaken', 'shareCustomLinkReserved', 'shareCustomLinkInvalid', 'shareCustomLinkKeepId']
    .forEach((key) => {
      expect(adminI18n.en[key]).toBeTruthy();
      expect(adminI18n.zh[key]).toBeTruthy();
    });
});

test('share tab shows the custom link field and keeps the project-id link', () => {
  renderShare('en');
  expect(screen.getByRole('textbox', { name: adminI18n.en.shareCustomLinkLabel })).toBeInTheDocument();
  expect(screen.getByText('http://localhost/survey?project=proj_1')).toBeInTheDocument();
});

test('reserved names show a clear error and do not save', async () => {
  renderShare('zh');
  fireEvent.change(screen.getByRole('textbox', { name: adminI18n.zh.shareCustomLinkLabel }), { target: { value: 'Admin' } });
  fireEvent.click(screen.getByRole('button', { name: adminI18n.zh.shareCustomLinkSave }));
  expect(await screen.findByText(adminI18n.zh.shareCustomLinkReserved)).toBeInTheDocument();
  expect(setProjectPublicSlug).not.toHaveBeenCalled();
});

test('a taken slug shows the server error and a saved slug becomes the share link', async () => {
  setProjectPublicSlug.mockResolvedValueOnce({ success: false, code: 'taken', error: 'slug_taken' });
  renderShare('en');
  const field = screen.getByRole('textbox', { name: adminI18n.en.shareCustomLinkLabel });
  fireEvent.change(field, { target: { value: 'campus-study' } });
  fireEvent.click(screen.getByRole('button', { name: adminI18n.en.shareCustomLinkSave }));
  expect(await screen.findByText(adminI18n.en.shareCustomLinkTaken)).toBeInTheDocument();

  setProjectPublicSlug.mockResolvedValueOnce({ success: true, publicSlug: 'campus-study' });
  fireEvent.click(screen.getByRole('button', { name: adminI18n.en.shareCustomLinkSave }));
  expect(await screen.findByText('http://localhost/s/campus-study')).toBeInTheDocument();
  expect(screen.getByText(/http:\/\/localhost\/survey\?project=proj_1/)).toBeInTheDocument();
  await waitFor(() => expect(setProjectPublicSlug).toHaveBeenLastCalledWith('proj_1', 'campus-study'));
});
