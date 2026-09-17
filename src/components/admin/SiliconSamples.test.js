import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RegionProvider } from '../../contexts/RegionContext';
import SiliconSamples from './SiliconSamples';
import * as agentApi from '../../lib/agentApi';

jest.mock('../../lib/agentApi', () => ({
  cancelSiliconRun: jest.fn(),
  createSiliconRun: jest.fn(),
  deleteSiliconPersona: jest.fn(),
  getCredentialStatus: jest.fn(),
  getSiliconCompare: jest.fn(),
  listSiliconPersonas: jest.fn(),
  listSiliconRuns: jest.fn(),
  processSiliconRun: jest.fn(),
  resumeSiliconRun: jest.fn(),
  retryFailedSiliconRun: jest.fn(),
  saveSiliconPersona: jest.fn(),
  exportSiliconRun: jest.fn(),
}));

function renderPage(surveyConfig) {
  return render(
    <RegionProvider>
      <ThemeProvider theme={createTheme()}>
        <SiliconSamples currentProject={{ id: 'p1', name: 'Study' }} surveyConfig={surveyConfig} />
      </ThemeProvider>
    </RegionProvider>,
  );
}

describe('SiliconSamples', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    agentApi.listSiliconPersonas.mockResolvedValue({
      success: true,
      personas: [{ id: 'persona-1', name: 'Resident' }],
    });
    agentApi.listSiliconRuns.mockResolvedValue({ success: true, runs: [] });
    agentApi.getCredentialStatus.mockResolvedValue({
      success: true,
      directory: [{
        id: 'openai',
        displayName: 'OpenAI',
        configured: true,
        models: [{ id: 'gpt-4o', label: 'GPT-4o', vision: true }],
      }],
      siliconRoute: { provider: 'openai', model: 'gpt-4o' },
    });
    agentApi.createSiliconRun.mockResolvedValue({
      success: true,
      run: { id: 'run-1', progress_total: 1 },
    });
    agentApi.processSiliconRun.mockResolvedValue({
      success: true,
      finished: true,
      status: 'completed',
    });
    agentApi.getSiliconCompare.mockResolvedValue({
      success: true,
      responseCount: 1,
      byQuestion: {},
      eventCounts: { answer: 1, skip: 0, error: 0 },
      disclaimer: 'Synthetic only',
    });
  });

  test('starts a bounded draft-snapshot run with the configured vision model', async () => {
    renderPage({
      pages: [{ elements: [{ type: 'rating', name: 'age', title: 'Age' }] }],
    });
    fireEvent.click(await screen.findByText('Resident'));
    const start = screen.getByRole('button', { name: 'Run silicon pretest' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    await waitFor(() => expect(agentApi.createSiliconRun).toHaveBeenCalledWith({
      projectId: 'p1',
      personaIds: ['persona-1'],
      repeats: 1,
      budgetTokens: 25000,
      provider: 'openai',
      model: 'gpt-4o',
      reasoningEffort: undefined,
      questionNames: ['age'],
    }));
    expect(agentApi.processSiliconRun).not.toHaveBeenCalled();
    expect(agentApi.getSiliconCompare).not.toHaveBeenCalled();
  });

  test('disables start when every supported question is deselected', async () => {
    renderPage({
      pages: [{ elements: [{ type: 'rating', name: 'age', title: 'Age' }] }],
    });
    fireEvent.click(await screen.findByText(/age \(rating\)/));
    const start = screen.getByRole('button', { name: 'Run silicon pretest' });
    await waitFor(() => expect(start).toBeDisabled());
  });

  test('starts a slider pretest and lists annotation as not preview-accepted', async () => {
    renderPage({
      pages: [{
        elements: [
          {
            type: 'imageslidergroup',
            name: 'scales',
            dimensions: [{ id: 'safe', label: '安全感', left: 'Unsafe', right: 'Safe' }],
          },
          { type: 'imageannotation', name: 'mark' },
        ],
      }],
    });
    expect(await screen.findByText(/scales \(imageslidergroup\)/)).toBeInTheDocument();
    expect(screen.getByText(/Listed but not preview-accepted/)).toBeInTheDocument();
    expect(screen.getByText(/mark \(imageannotation\)/)).toBeInTheDocument();
    fireEvent.click(await screen.findByText('Resident'));
    const start = screen.getByRole('button', { name: 'Run silicon pretest' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(agentApi.createSiliconRun).toHaveBeenCalledWith(expect.objectContaining({
      questionNames: ['scales'],
    })));
    expect(screen.getByText(/1 personas · 1 simulated responses · 1 questions, 1 trials/)).toBeInTheDocument();
  });

  test('does not reselect every question when the supported list refreshes', async () => {
    const first = {
      pages: [{
        elements: [
          { type: 'rating', name: 'age', title: 'Age' },
          { type: 'imagerating', name: 'comfort', title: 'Comfort', trialCount: 4 },
        ],
      }],
    };
    const { rerender } = renderPage(first);
    fireEvent.click(await screen.findByText(/age \(rating\)/));
    rerender(
      <RegionProvider>
        <ThemeProvider theme={createTheme()}>
          <SiliconSamples
            currentProject={{ id: 'p1', name: 'Study' }}
            surveyConfig={{
              pages: [{
                elements: [
                  { type: 'rating', name: 'age', title: 'Age' },
                  { type: 'imagerating', name: 'comfort', title: 'Comfort', trialCount: 4 },
                  { type: 'text', name: 'note', title: 'Note' },
                ],
              }],
            }}
          />
        </ThemeProvider>
      </RegionProvider>,
    );
    fireEvent.click(await screen.findByText('Resident'));
    fireEvent.click(screen.getByRole('button', { name: 'Run silicon pretest' }));
    await waitFor(() => expect(agentApi.createSiliconRun).toHaveBeenCalledWith(expect.objectContaining({
      questionNames: ['comfort'],
    })));
  });

  test('renders an existing run status without crashing', async () => {
    agentApi.listSiliconRuns.mockResolvedValue({
      success: true,
      runs: [{
        id: 'run-existing',
        status: 'completed',
        progress_done: 1,
        progress_total: 1,
        progress_processed: 1,
        progress_valid: 1,
        progress_failed: 0,
        counts_ready: true,
        tokens_used: 100,
        question_names: ['age'],
      }],
    });
    renderPage();
    expect(await screen.findByText(/1\/1 trials/)).toBeInTheDocument();
    expect(await screen.findByText(/Finished with valid answers/)).toBeInTheDocument();
    expect(agentApi.getSiliconCompare).not.toHaveBeenCalled();
  });
});
