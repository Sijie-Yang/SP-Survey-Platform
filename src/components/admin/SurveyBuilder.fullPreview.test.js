import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SurveyBuilder from './SurveyBuilder';
import { RegionProvider } from '../../contexts/RegionContext';

jest.mock('./AiAssistantPanel', () => () => null);

const config = {
  title: 'Study',
  pages: [{ name: 'page1', title: 'Page 1', elements: [] }],
};

function renderBuilder(language, onOpenFullPreview = jest.fn()) {
  localStorage.setItem('sp-survey-language', language);
  return render(
    <RegionProvider>
      <SurveyBuilder
        config={config}
        onChange={jest.fn()}
        onNextStep={jest.fn()}
        onOpenFullPreview={onOpenFullPreview}
        hideAssistant
        currentProject={{ id: 'project-1' }}
      />
    </RegionProvider>,
  );
}

afterEach(() => localStorage.clear());

test('Full Preview is the primary action and Add New Page sits with Next', () => {
  const open = jest.fn();
  renderBuilder('en', open);
  const primary = document.querySelector('[data-admin-primary-action]');
  expect(within(primary).getByRole('button', { name: 'Full Preview' })).toHaveClass('MuiButton-contained');
  expect(within(primary).queryByRole('button', { name: 'Add New Page' })).not.toBeInTheDocument();
  const row = document.querySelector('[data-builder-page-actions]');
  const addPage = within(row).getByRole('button', { name: 'Add New Page' });
  expect(addPage).toHaveClass('MuiButton-outlined');
  expect(within(row).getByRole('button', { name: /Next: Share Survey/ })).toBeInTheDocument();
  fireEvent.click(within(primary).getByRole('button', { name: 'Full Preview' }));
  expect(open).toHaveBeenCalledTimes(1);
});

test('Chinese builder uses the same button placement', () => {
  renderBuilder('zh');
  const primary = document.querySelector('[data-admin-primary-action]');
  expect(within(primary).getByRole('button', { name: '完整预览' })).toBeInTheDocument();
  const row = document.querySelector('[data-builder-page-actions]');
  expect(within(row).getByRole('button', { name: '添加新页面' })).toHaveClass('MuiButton-outlined');
  expect(within(row).getByRole('button', { name: /下一步：分享问卷/ })).toBeInTheDocument();
});
