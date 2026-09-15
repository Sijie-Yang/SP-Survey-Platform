import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RegionProvider } from '../../contexts/RegionContext';
import AiAssistantSidebar from './AiAssistantSidebar';
import {
  AI_SIDEBAR_ID,
  AI_SIDEBAR_WIDTH,
  PROJECT_SIDEBAR_WIDTH,
  exclusiveSidebarOpen,
  workspaceChromeWidths,
} from '../../hooks/surveyAssistantUtils';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}), { virtual: true });

jest.mock('../../lib/agentApi', () => ({
  listMcpConnections: () => Promise.resolve({ connections: [] }),
}));

jest.mock('./ModelsSettings', () => function ModelsSettingsMock() {
  return <div>Models settings</div>;
});

function assistantFixture(overrides = {}) {
  return {
    messages: [],
    userMessage: '',
    isLoading: false,
    loadingStatus: '',
    apiKeyValid: true,
    openaiApiKey: '',
    credentialHint: 'openai',
    isPlatformMode: true,
    contextEnabled: true,
    multiAgentReviewEnabled: false,
    reviewMode: '1v1',
    maxReviewRounds: 3,
    recommendations: [],
    currentProject: { id: 'p1', name: 'Park Study' },
    conversationHistoryRef: { current: null },
    workingMemoryRef: { current: null },
    sessionLearningRef: { current: null },
    setUserMessage: jest.fn(),
    handleSendMessage: jest.fn(),
    setOpenaiApiKey: jest.fn(),
    handleValidateApiKey: jest.fn(),
    setContextEnabled: jest.fn(),
    setMultiAgentReviewEnabled: jest.fn(),
    setReviewMode: jest.fn(),
    setMaxReviewRounds: jest.fn(),
    handleClearHistory: jest.fn(),
    handleDownloadHistory: jest.fn(),
    setCustomPrompts: jest.fn(),
    applyCredentialStatus: jest.fn(),
    chatEndRef: { current: null },
    aiUndoAvailable: false,
    handleRevertAiChange: jest.fn(),
    modelOptions: [{ value: 'openai::gpt-4o', label: 'OpenAI / GPT-4o' }],
    selectedRoute: 'openai::gpt-4o',
    selectedEffort: '',
    effortOptions: [],
    handleAssistantRouteChange: jest.fn(),
    handleAssistantEffortChange: jest.fn(),
    routeUnavailable: '',
    blockReason: '',
    ...overrides,
  };
}

function renderSidebar(props = {}) {
  const assistant = props.assistant || assistantFixture();
  return render(
    <RegionProvider>
      <ThemeProvider theme={createTheme()}>
        <AiAssistantSidebar
          open
          onClose={jest.fn()}
          assistant={assistant}
          onOpenSilicon={jest.fn()}
          variant={props.variant || 'persistent'}
        />
      </ThemeProvider>
    </RegionProvider>,
  );
}

describe('AiAssistantSidebar', () => {
  test('renders a persistent right drawer with a fixed composer', () => {
    renderSidebar({ variant: 'persistent' });
    const drawer = document.getElementById(AI_SIDEBAR_ID);
    expect(drawer).toBeTruthy();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByLabelText('Assistant settings')).toBeInTheDocument();
    expect(screen.getAllByText('Park Study').length).toBeGreaterThan(0);
  });

  test('uses a temporary overlay variant on mobile', () => {
    renderSidebar({ variant: 'temporary' });
    const drawer = document.getElementById(AI_SIDEBAR_ID);
    expect(drawer).toBeTruthy();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  test('disables sending when no project is selected', () => {
    renderSidebar({
      assistant: assistantFixture({
        currentProject: null,
        blockReason: 'no-project',
        apiKeyValid: true,
      }),
    });
    expect(screen.getByText('Select a project first to send messages.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  test('keeps composer at the bottom of the sidebar', () => {
    renderSidebar();
    const input = screen.getByRole('textbox');
    const composer = input.closest('div');
    expect(composer).toBeTruthy();
    const sidebar = document.getElementById(AI_SIDEBAR_ID);
    expect(sidebar.contains(input)).toBe(true);
  });
});

function LayoutHarness() {
  const [isDesktop] = useState(false);
  const [projectOpen, setProjectOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const widths = workspaceChromeWidths({ projectOpen, aiOpen, isDesktop });

  return (
    <div>
      <button
        type="button"
        aria-expanded={aiOpen}
        aria-controls={AI_SIDEBAR_ID}
        onClick={() => {
          const next = !aiOpen;
          setAiOpen(next);
          if (next) setProjectOpen(exclusiveSidebarOpen({ isDesktop, otherIsOpen: projectOpen }).otherOpen);
        }}
      >
        Toggle AI
      </button>
      <button
        type="button"
        onClick={() => {
          const next = !projectOpen;
          setProjectOpen(next);
          if (next) setAiOpen(exclusiveSidebarOpen({ isDesktop, otherIsOpen: aiOpen }).otherOpen);
        }}
      >
        Toggle Projects
      </button>
      <div data-testid="left-width">{widths.left}</div>
      <div data-testid="right-width">{widths.right}</div>
      <div data-testid="project-open">{String(projectOpen)}</div>
      <div data-testid="ai-open">{String(aiOpen)}</div>
    </div>
  );
}

describe('admin dual-sidebar layout', () => {
  test('mobile AI toggle closes Projects and does not reserve right margin', () => {
    render(<LayoutHarness />);
    fireEvent.click(screen.getByText('Toggle AI'));
    expect(screen.getByTestId('ai-open')).toHaveTextContent('true');
    expect(screen.getByTestId('project-open')).toHaveTextContent('false');
    expect(screen.getByTestId('right-width')).toHaveTextContent('0');
    expect(screen.getByTestId('left-width')).toHaveTextContent('0');

    fireEvent.click(screen.getByText('Toggle Projects'));
    expect(screen.getByTestId('project-open')).toHaveTextContent('true');
    expect(screen.getByTestId('ai-open')).toHaveTextContent('false');
    expect(screen.getByTestId('left-width')).toHaveTextContent(String(PROJECT_SIDEBAR_WIDTH));
  });

  test('desktop can keep both sidebars and reserve both widths', () => {
    const widths = workspaceChromeWidths({ projectOpen: true, aiOpen: true, isDesktop: true });
    expect(widths.left).toBe(PROJECT_SIDEBAR_WIDTH);
    expect(widths.right).toBe(AI_SIDEBAR_WIDTH);
  });
});
