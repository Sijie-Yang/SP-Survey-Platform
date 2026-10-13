import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpSchemePanel from './SpSchemePanel';
import { RegionProvider } from '../../contexts/RegionContext';
import { strToU8, zipSync } from 'fflate';
import { buildExampleZip } from '../../lib/spScheme';

function renderPanel(props = {}) {
  const onChange = jest.fn();
  const saveSkill = jest.fn(async (skill) => ({ skill: { ...skill, id: 'skill_saved_1', revision: 1 } }));
  render(
    <RegionProvider>
      <SpSchemePanel config={{ pages: [], theme: { primaryColor: '#111111' } }} onChange={onChange} saveSkill={saveSkill} {...props} />
    </RegionProvider>,
  );
  return { onChange, saveSkill };
}

test('copies the scheme to the clipboard', async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Copy SP-Scheme|复制 SP-Scheme/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(writeText.mock.calls[0][0]).toContain('sp-scheme-package');
});

test('pasted JSON is checked and blocked when it has problems', async () => {
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Paste JSON|粘贴 JSON/ }));
  fireEvent.change(screen.getByLabelText('SP-Scheme package'), { target: { value: '{"format":"sp-scheme-package","survey":{"pages":[{"name":"p","elements":[{"type":"skillquestion","name":"q","skillId":"custom:missing"}]}]}}' } });
  fireEvent.click(screen.getByRole('button', { name: /Check format|检查格式/ }));
  expect(await screen.findByText(/no customInteractions entry/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Import into Builder|导入 Builder/ })).toBeDisabled();
});

test('an uploaded zip is checked and imported only after it passes', async () => {
  const { onChange, saveSkill } = renderPanel();
  const file = new File([buildExampleZip()], 'study.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [file] } });
  expect(await screen.findByText(/Format aligned|格式与平台对齐/)).toBeInTheDocument();
  expect(screen.getByText(/file\(s\) read|个文件/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Import into Builder|导入 Builder/ }));

  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  expect(saveSkill).toHaveBeenCalledTimes(1);
  expect(saveSkill.mock.calls[0][0].sourceHtml).not.toContain('sp-preview-shim');
  const next = onChange.mock.calls[0][0];
  expect(next.pages[1].elements[0].skillId).toBe('skill_saved_1');
  expect(next.theme.primaryColor).toBe('#111111');
});

test('warns when a prototype was packed without its custom interactions', async () => {
  renderPanel();
  const manifest = {
    format: 'sp-scheme-package',
    spScheme: '1.0',
    survey: { title: 'High street', pages: [{ name: 'p1', elements: [{ type: 'skillquestion', name: 'ab', skillId: 'preset_image_preference_forced', imageCount: 2, skillConfig: { mediaCount: 2, mediaType: 'image' } }] }] },
  };
  const zip = zipSync({ 'sp-scheme.json': strToU8(JSON.stringify(manifest)), 'preview.html': strToU8('<html></html>') });
  fireEvent.change(screen.getByTestId('sp-scheme-file'), { target: { files: [new File([zip], 'hs.zip')] } });
  expect(await screen.findByTestId('sp-scheme-no-custom')).toBeInTheDocument();
});
