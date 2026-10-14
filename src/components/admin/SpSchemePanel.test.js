import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SpSchemePanel from './SpSchemePanel';
import { RegionProvider } from '../../contexts/RegionContext';
import { buildExampleSite, buildExampleZip } from '../../lib/spScheme';
import { convertSurveyPage, fetchSurveyPage, fetchSurveyPageMedia } from '../../lib/agentApi';
import { LEGACY_SURVEY_CONVERSION, LEGACY_SURVEY_HTML } from '../../lib/__fixtures__/legacySurvey';

jest.mock('../../lib/agentApi', () => ({ convertSurveyPage: jest.fn(), fetchSurveyPage: jest.fn(), fetchSurveyPageMedia: jest.fn() }));
jest.mock('../../contexts/AuthContext', () => ({ useOptionalAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../lib/r2', () => ({ uploadImageToR2: jest.fn() }));

function renderPanel(props = {}) {
  const onChange = jest.fn();
  render(
    <RegionProvider>
      <SpSchemePanel config={{ pages: [], theme: { primaryColor: '#111111' } }} onChange={onChange} {...props} />
    </RegionProvider>,
  );
  return { onChange };
}

test('copies the scheme to the clipboard', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Copy SP-Scheme|复制 SP-Scheme/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(writeText.mock.calls[0][0]).toContain('SPSite.answer');
});

test('pasted code is checked and blocked when it has problems', async () => {
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Paste code|粘贴代码/ }));
  fireEvent.change(screen.getByLabelText('SP-Scheme package'), { target: { value: '<!doctype html><html><body>hello</body></html>' } });
  fireEvent.click(screen.getByRole('button', { name: /Check format|检查格式/ }));
  expect(await screen.findByTestId('sp-scheme-verdict')).toHaveTextContent(/not a survey file that matches SP-Scheme|不是符合 SP-Scheme/);
  expect(screen.getByRole('button', { name: /Import into Builder|导入 Builder/ })).toBeDisabled();
});

test('an uploaded zip is checked, then imported with its page', async () => {
  const { onChange } = renderPanel();
  const file = new File([buildExampleZip()], 'study.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  expect(await screen.findByText(/Format aligned|格式与平台对齐/)).toBeInTheDocument();
  expect(screen.getByTestId('sp-scheme-site')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Import into Builder|导入 Builder/ }));

  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0][0];
  expect(next.spSite.html).toContain('SPSite.onReady');
  expect(next.spSite.html).not.toContain('sp-site-preview');
  expect(next.theme.primaryColor).toBe('#111111');
});

test('shows the active page and can remove it', () => {
  const { onChange } = renderPanel({ config: { pages: [], spSite: { html: buildExampleSite(), id: 'site-1' } } });
  expect(screen.getByTestId('sp-site-active')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Remove|移除/ }));
  expect(onChange.mock.calls[0][0].spSite).toBeUndefined();
});

test('converts an ordinary survey page with the model, then imports it with the ticked domains', async () => {
  convertSurveyPage.mockResolvedValue({ result: LEGACY_SURVEY_CONVERSION, model: 'free' });
  const { onChange } = renderPanel();
  const file = new File([LEGACY_SURVEY_HTML], 'survey.html', { type: 'text/html' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  fireEvent.click(await screen.findByTestId('sp-scheme-convert'));

  expect(await screen.findByTestId('sp-scheme-converted')).toBeInTheDocument();
  expect(screen.getByText(/Format aligned|格式与平台对齐/)).toBeInTheDocument();
  expect(screen.getByTestId('sp-scheme-original-images')).toHaveTextContent('street_01.jpg');
  const hosts = screen.getByTestId('sp-scheme-hosts');
  expect(hosts).toHaveTextContent('cdn.legacy-lab.org');
  expect(hosts).toHaveTextContent('api.legacy-lab.org');

  fireEvent.click(screen.getByRole('button', { name: /Import into Builder|导入 Builder/ }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0][0];
  expect(next.spSite.allowedHosts).toEqual(['cdn.legacy-lab.org']);
  expect(next.spSite.html).toContain('data-sp-adapter');
  expect(next.pages[0].elements.map((e) => e.name)).toEqual(['safety', 'comment']);
});

test('unticking a domain the page loads its script from blocks the import', async () => {
  convertSurveyPage.mockResolvedValue({ result: LEGACY_SURVEY_CONVERSION, model: 'free' });
  renderPanel();
  const file = new File([LEGACY_SURVEY_HTML], 'survey.html', { type: 'text/html' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  fireEvent.click(await screen.findByTestId('sp-scheme-convert'));
  await screen.findByTestId('sp-scheme-converted');
  fireEvent.click(screen.getByRole('checkbox', { name: /cdn\.legacy-lab\.org/ }));
  expect(await screen.findByText(/Scripts must be inline/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Import into Builder|导入 Builder/ })).toBeDisabled();
});

test('a page that does not match SP-Scheme says so, with a copy button next to it', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  renderPanel();
  const file = new File([LEGACY_SURVEY_HTML], 'survey.html', { type: 'text/html' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  const verdict = await screen.findByTestId('sp-scheme-verdict');
  expect(verdict).toHaveTextContent(/not a survey file that matches SP-Scheme|不是符合 SP-Scheme 的问卷文件/);
  fireEvent.click(within(verdict).getByRole('button', { name: /Copy SP-Scheme|复制 SP-Scheme/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(await within(verdict).findByRole('button', { name: /Copied|已复制/ })).toBeInTheDocument();
});

test('dropping the page with its config sends the config to the model', async () => {
  convertSurveyPage.mockResolvedValue({ result: LEGACY_SURVEY_CONVERSION, model: 'free' });
  renderPanel();
  const files = [
    new File([LEGACY_SURVEY_HTML], 'index.html', { type: 'text/html' }),
    new File(['{"tasks":[{"id":"safety"}]}'], 'config.json', { type: 'application/json' }),
  ];
  fireEvent.drop(screen.getByTestId('sp-scheme-panel'), { dataTransfer: { files, types: ['Files'] } });
  expect(await screen.findByText(/config\.json/)).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('sp-scheme-convert'));
  await screen.findByTestId('sp-scheme-converted');
  expect(convertSurveyPage.mock.calls[0][0].dataFiles).toEqual([
    expect.objectContaining({ name: 'config.json', text: '{"tasks":[{"id":"safety"}]}' }),
  ]);
});

test('a survey link is fetched, its stimuli downloaded and planned for the media library', async () => {
  const pageHtml = '<!doctype html><html><head><base href="https://lab.github.io/rating/"></head><body><img id="a"><img id="b"><button id="go">Next</button><script>fetch("https://script.google.com/macros/s/x/exec",{method:"POST",body:"{}"});</script></body></html>';
  fetchSurveyPage.mockResolvedValue({ success: true, html: pageHtml, url: 'https://lab.github.io/rating/', host: 'lab.github.io', dataFiles: [] });
  fetchSurveyPageMedia.mockImplementation(async () => new Blob(['JPEG'], { type: 'image/jpeg' }));
  const originalFetch = global.fetch;
  global.fetch = jest.fn(() => Promise.reject(new TypeError('CORS')));
  const pair = {
    type: 'imagepicker', name: 'pick', title: 'Which looks more similar?', imageCount: 2, trialCount: 1, isRequired: true,
    imageSelectionMode: 'huggingface_random', randomImageSelection: true,
  };
  const adapter = "SPSite.onReady(function(){}); SPSite.onSubmit(function(){ SPSite.answer('pick','image_0').then(function(){ return SPSite.complete(); }); });";
  convertSurveyPage
    .mockResolvedValueOnce({ result: { survey: { pages: [{ elements: [pair] }] }, adapterScript: adapter, originalImages: [{ url: 'img/1.jpg' }, { url: 'img/2.jpg' }] } })
    .mockResolvedValueOnce({ result: { survey: { pages: [{ elements: [{ ...pair, mediaFolders: ['rating/img'] }] }] }, adapterScript: adapter } });
  try {
    renderPanel({ currentProject: { id: 'p1' }, onProjectUpdate: jest.fn() });
    fireEvent.click(screen.getByRole('button', { name: /Paste code|粘贴代码/ }));
    fireEvent.change(screen.getByLabelText('Survey web address'), { target: { value: 'https://lab.github.io/rating/' } });
    fireEvent.click(screen.getByTestId('sp-scheme-fetch-url'));
    expect(await screen.findByTestId('sp-scheme-hosts')).toHaveTextContent('lab.github.io');
    fireEvent.click(await screen.findByTestId('sp-scheme-convert'));
    expect(await screen.findByTestId('sp-scheme-converted')).toHaveTextContent(/Converted by the model|已由模型转换/);
    expect(fetchSurveyPageMedia).toHaveBeenCalledTimes(2);
    expect(convertSurveyPage.mock.calls[1][0].mediaFiles).toEqual(['rating/img/1.jpg', 'rating/img/2.jpg']);
    expect(screen.getByTestId('sp-scheme-media-plan')).toHaveTextContent('rating/img · 2');
  } finally {
    global.fetch = originalFetch;
  }
});
