import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpSchemePanel from './SpSchemePanel';
import { RegionProvider } from '../../contexts/RegionContext';
import { buildExampleSite, buildExampleZip } from '../../lib/spScheme';

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
  expect(await screen.findByText(/id="sp-scheme"/)).toBeInTheDocument();
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
