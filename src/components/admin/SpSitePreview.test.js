import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpSitePreview from './SpSitePreview';

const frameProps = {};
jest.mock('../SpSiteFrame', () => ({ __esModule: true, default: (props) => { Object.assign(frameProps, props); return <div data-testid="sp-site-frame" />; } }));
jest.mock('../SpSiteSurvey', () => ({ applyPageState: (s) => s, captureRecord: () => null, pageSaysFinished: () => false }));

const config = { pages: [], spSite: { html: '<p>page</p>', id: 's1' } };

test('the classic editor keeps the notice about how the page was imported', () => {
  render(<SpSitePreview config={config} previewLibrary />);
  expect(screen.getByTestId('sp-site-match')).toBeInTheDocument();
  expect(screen.queryByTestId('sp-site-sample-images')).toBeNull();
});

test('Studio drops that notice and says in one line when sample images are shown', () => {
  const { rerender } = render(<SpSitePreview config={config} previewLibrary hideImportNotice />);
  expect(screen.queryByTestId('sp-site-match')).toBeNull();
  expect(screen.getByTestId('sp-site-sample-images')).toHaveTextContent("The preview uses the platform's sample images. Upload your own images.");
  rerender(<SpSitePreview config={config} hideImportNotice />);
  expect(screen.queryByTestId('sp-site-sample-images')).toBeNull();
  expect(screen.queryByTestId('sp-site-match')).toBeNull();
});

test('the preview has a "next screen" button that asks the page to skip one screen', async () => {
  render(<SpSitePreview config={config} />);
  expect(frameProps.previewScript).toContain('__SP_PREVIEW_TOOLS__');
  // Until a screen is skipped, required answers are checked as on the survey link.
  expect(frameProps.requireAnswers).toBe(true);
  const skip = jest.fn().mockResolvedValueOnce({ moved: true }).mockResolvedValueOnce({ moved: false });
  frameProps.controlRef.current = { skip };
  fireEvent.click(screen.getByTestId('sp-site-preview-skip'));
  await waitFor(() => expect(screen.getByTestId('sp-site-preview-skip')).toBeEnabled());
  expect(skip).toHaveBeenCalledTimes(1);
  expect(frameProps.requireAnswers).toBe(false);
  expect(screen.getByTestId('sp-site-preview-skipnote')).toHaveTextContent('The survey link runs as a real survey.');
  fireEvent.click(screen.getByTestId('sp-site-preview-skip'));
  expect(await screen.findByText(/could not be skipped automatically/)).toBeInTheDocument();
});
