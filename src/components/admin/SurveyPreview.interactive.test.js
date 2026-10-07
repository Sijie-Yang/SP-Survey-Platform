import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FullSurveyPreview from './FullSurveyPreview';
import { createSurveyPreviewModel } from './SurveyPreview';
import { RegionProvider } from '../../contexts/RegionContext';

jest.mock('../../lib/previewMediaLibrary', () => ({
  resolveMediaPoolForPreview: async () => [],
  resolvePreviewMediaContext: async () => ({ images: [], imageDatasetConfig: {}, fromPreviewLibrary: false }),
  adaptSurveyForPreviewLibrary: (config) => config,
  surveyUsesSampledMedia: () => false,
}));

const initialConfig = {
  title: 'Preview study',
  pages: [
    {
      name: 'p1',
      title: 'Page One',
      elements: [
        { type: 'text', name: 'q1', title: 'Alpha question' },
        { type: 'text', name: 'q2', title: 'Beta question' },
      ],
    },
    {
      name: 'p2',
      title: 'Page Two',
      elements: [
        { type: 'text', name: 'q3', title: 'Gamma question' },
        { type: 'text', name: 'q4', title: 'Delta question' },
      ],
    },
  ],
};

let latest = initialConfig;

function Harness() {
  const [config, setConfig] = useState(initialConfig);
  latest = config;
  return (
    <RegionProvider>
      <FullSurveyPreview
        config={config}
        currentProject={{ preloadedImages: [] }}
        onConfigChange={setConfig}
      />
    </RegionProvider>
  );
}

beforeEach(() => {
  latest = initialConfig;
  localStorage.setItem('sp-survey-language', 'en');
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => localStorage.clear());

test('format preview starts on page 1 and cannot be answered', async () => {
  expect(createSurveyPreviewModel(initialConfig).mode).toBe('display');
  const formatPreview = createSurveyPreviewModel(initialConfig, null, { interactive: true });
  expect(formatPreview.mode).toBe('display');
  expect(formatPreview.currentPageNo).toBe(0);

  render(<Harness />);
  expect(await screen.findByText('Alpha question')).toBeInTheDocument();
  expect(screen.queryByText('Gamma question')).not.toBeInTheDocument();
  expect(document.querySelector('[data-preview-mode]')).toHaveAttribute('data-preview-mode', 'format');
  expect(document.querySelector('[data-preview-page]')).toHaveAttribute('data-preview-page', '1');
  expect(screen.getByText('Sizing: Desktop')).toBeInTheDocument();
  expect(screen.getByText('Layout only. Questions cannot be answered here.')).toBeInTheDocument();

  const answer = screen.getByRole('textbox', { name: 'Alpha question' });
  expect(answer).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
  expect(await screen.findByText('Gamma question')).toBeInTheDocument();
  expect(screen.queryByText('Alpha question')).not.toBeInTheDocument();
});

test('viewport sizes save separately and text or order stays shared', async () => {
  render(<Harness />);
  expect(await screen.findByText('Alpha question')).toBeInTheDocument();

  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '480');
  expect(screen.getByText('Question 1 of 2: Alpha question')).toBeInTheDocument();
  expect(screen.getByText('Page 1 of 2: Page One')).toBeInTheDocument();

  const media = screen.getByRole('slider', { name: 'Media height' });
  fireEvent.change(media, { target: { value: '360' } });
  expect(latest.viewportLayout.desktop.mediaMaxHeight).toBe(360);
  expect(latest.viewportLayout.mobile).toBeUndefined();
  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '360');
  expect(document.querySelector('[data-sp-viewport]')).toHaveAttribute('data-sp-viewport', 'desktop');
  expect(screen.getByText('360 px')).toBeInTheDocument();

  const width = screen.getByRole('slider', { name: 'Content width' });
  fireEvent.change(width, { target: { value: '1040' } });
  expect(latest.viewportLayout.desktop.contentWidth).toBe(1040);
  expect(document.querySelector('[data-sp-content-width]')).toHaveAttribute('data-sp-content-width', '1040');

  const card = screen.getByRole('slider', { name: 'Question card width' });
  fireEvent.change(card, { target: { value: '720' } });
  expect(latest.viewportLayout.desktop.questionWidth).toBe(720);
  expect(latest.viewportLayout.mobile).toBeUndefined();
  expect(document.querySelector('[data-sp-question-width]')).toHaveAttribute('data-sp-question-width', '720');

  fireEvent.change(screen.getByLabelText('Survey title'), { target: { value: 'Renamed study' } });
  expect(latest.title).toBe('Renamed study');
  fireEvent.change(screen.getByLabelText('Survey description'), { target: { value: 'A short intro' } });
  expect(latest.description).toBe('A short intro');
  fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: 'https://example.com/mark.png' } });
  expect(latest.logo).toBe('https://example.com/mark.png');
  await waitFor(() => {
    expect(document.querySelector('.sd-logo__image')).toHaveAttribute('src', 'https://example.com/mark.png');
  });

  fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
  expect(screen.getByText('Sizing: Mobile')).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Media height' })).toHaveAttribute('aria-valuenow', '320');
  expect(document.querySelector('[data-sp-viewport]')).toHaveAttribute('data-sp-viewport', 'mobile');
  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '320');
  expect(latest.viewportLayout.desktop.questionWidth).toBe(720);
  expect(latest.viewportLayout.mobile?.questionWidth).toBeUndefined();

  fireEvent.change(screen.getByRole('slider', { name: 'Media height' }), { target: { value: '240' } });
  expect(latest.viewportLayout.desktop.mediaMaxHeight).toBe(360);
  expect(latest.viewportLayout.mobile.mediaMaxHeight).toBe(240);
  expect(document.querySelector('[data-sp-media-max-height]')).toHaveAttribute('data-sp-media-max-height', '240');

  fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
  const title = document.querySelector('[data-sp-edit="question-title"]');
  expect(title).toBeTruthy();
  title.textContent = 'Alpha edited';
  fireEvent.blur(title);
  expect(latest.pages[0].elements[0].title).toBe('Alpha edited');
  expect(latest.viewportLayout.desktop.mediaMaxHeight).toBe(360);

  fireEvent.click(screen.getAllByRole('button', { name: 'Move question down' })[0]);
  expect(latest.pages[0].elements.map((element) => element.name)).toEqual(['q2', 'q1']);
  expect(latest.pages[0].elements[1].title).toBe('Alpha edited');

  fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
  expect(await screen.findByText('Gamma question')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Move question down' })[0]);
  expect(latest.pages[1].elements.map((element) => element.name)).toEqual(['q4', 'q3']);
  expect(screen.queryByText('Alpha question')).not.toBeInTheDocument();
  expect(latest.viewportLayout.mobile.mediaMaxHeight).toBe(240);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});
