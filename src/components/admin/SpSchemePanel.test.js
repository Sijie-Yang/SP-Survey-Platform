import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpSchemePanel from './SpSchemePanel';
import { RegionProvider } from '../../contexts/RegionContext';
import { SP_SCHEME_EXAMPLE_PACKAGE } from '../../lib/spScheme';

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

test('checks a pasted package and imports it only after it passes', async () => {
  const { onChange, saveSkill } = renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Paste and check|粘贴并检查/ }));
  const box = screen.getByLabelText('SP-Scheme package');
  const importButton = screen.getByRole('button', { name: /Import into Builder|导入 Builder/ });

  fireEvent.change(box, { target: { value: '{"format":"sp-scheme-package","survey":{"pages":[{"name":"p","elements":[{"type":"skillquestion","name":"q","skillId":"custom:missing"}]}]}}' } });
  fireEvent.click(screen.getByRole('button', { name: /Check format|检查格式/ }));
  expect(await screen.findByText(/no customInteractions entry/)).toBeInTheDocument();
  expect(importButton).toBeDisabled();

  fireEvent.change(box, { target: { value: `\`\`\`json\n${JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE)}\n\`\`\`` } });
  fireEvent.click(screen.getByRole('button', { name: /Check format|检查格式/ }));
  expect(await screen.findByText(/Format aligned|格式与平台对齐/)).toBeInTheDocument();
  fireEvent.click(importButton);

  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  expect(saveSkill).toHaveBeenCalledTimes(1);
  const next = onChange.mock.calls[0][0];
  expect(next.pages[1].elements[0].skillId).toBe('skill_saved_1');
  expect(next.theme.primaryColor).toBe('#111111');
});
