import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminSpSchemeDiagnosisDialog from './AdminSpSchemeDiagnosisDialog';
import { fetchAdminResponsePage } from '../../lib/adminResults';
import { downloadZip } from '../../lib/zipDownload';
import { fetchUrlBytes } from '../../lib/mediaLibraryDownload';

jest.mock('../../lib/adminResults', () => ({
  createResponseLoadSession: () => ({ contracts: new Map(), mode: 'auto' }),
  fetchAdminResponsePage: jest.fn(),
}));
jest.mock('../../lib/mediaLibraryDownload', () => ({ fetchUrlBytes: jest.fn() }));
jest.mock('../../lib/zipDownload', () => ({ downloadZip: jest.fn() }));

const project = {
  id: 'proj_1',
  name: 'Street study',
  config: {
    pages: [],
    spSite: { html: '<html><body><script>const PHOTO_URLS = []; SPSite.complete();</script></body></html>', convertedFrom: 'study.zip', mediaFolders: ['images'] },
  },
  preloadedImages: [{ url: 'https://media.example/images/a.jpg', name: 'a.jpg', folder: 'images' }],
};

describe('AdminSpSchemeDiagnosisDialog', () => {
  beforeEach(() => {
    fetchAdminResponsePage.mockImplementation(async (id, offset, after, session) => {
      session.total = 12;
      return [{ id: 'r1', created_at: '2026-10-27T10:00:00Z', responses: { __sp_requests: [{}], __sp_page_state: { 'sp-media:PHOTO_URLS': [] } } }];
    });
    fetchUrlBytes.mockImplementation(async () => new Uint8Array([1]));
    downloadZip.mockClear();
  });

  it('shows the checks and the response count, and downloads the rebuilt upload', async () => {
    render(<AdminSpSchemeDiagnosisDialog project={project} onClose={() => {}} />);
    expect(screen.getByText('原样导入')).toBeTruthy();
    expect(screen.getByText('空图片列表 PHOTO_URLS')).toBeTruthy();
    await screen.findByText(/共 12 份/);
    fireEvent.click(screen.getByRole('button', { name: /下载上传文件和诊断/ }));
    await waitFor(() => expect(downloadZip).toHaveBeenCalled());
    const [name, files] = downloadZip.mock.calls[0];
    expect(name).toBe('Street-study-sp-scheme-diagnosis.zip');
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(['README.md', 'index.html', 'media/images/a.jpg']));
    expect(await screen.findByText(/已下载，含 1 个图片/)).toBeTruthy();
  });

  it('starts the download by itself when opened from the download button', async () => {
    render(<AdminSpSchemeDiagnosisDialog project={project} autoDownload onClose={() => {}} />);
    await waitFor(() => expect(downloadZip).toHaveBeenCalledTimes(1));
  });
});
