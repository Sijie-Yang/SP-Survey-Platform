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
  saveSiliconPersona: jest.fn(),
}));

function renderPage() {
  return render(
    <RegionProvider>
      <ThemeProvider theme={createTheme()}>
        <SiliconSamples currentProject={{ id: 'p1', name: 'Study' }} />
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
      disclaimer: 'Synthetic only',
    });
  });

  test('starts a bounded draft-snapshot run with the configured vision model', async () => {
    renderPage();
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
    }));
    await waitFor(() => expect(agentApi.getSiliconCompare).toHaveBeenCalledWith('run-1'));
  });
});
