import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import SurveyApp from './SurveyApp';

jest.mock('./lib/projectManager', () => {
  const calls = { resolve: [], load: [] };
  return {
    calls,
    getParticipantProject: async (id) => {
      calls.load.push(id);
      return {
        id,
        _surveyConfig: {
          title: 'Campus study',
          showProgressBar: 'off',
          pages: [{ name: 'about', elements: [{ type: 'text', name: 'rater_id', title: 'Rater ID' }] }],
        },
        preloadedImages: [],
      };
    },
    resolveSurveySlug: async (slug) => {
      calls.resolve.push(slug);
      return slug === 'campus-study' ? 'campus' : null;
    },
  };
});
jest.mock('./lib/supabase', () => ({ isSupabaseConfigured: () => false, saveSurveyResponse: jest.fn() }));
jest.mock('./lib/liveSurveyManager', () => ({ getProjectLiveAccess: async () => ({ gated: false, allowed: true }), formatLiveWindow: () => '' }));
jest.mock('./lib/surveyPublicApi', () => ({ fetchPairStats: async () => null, countProjectResponses: async () => 0, fetchConditionCounts: async () => null }));

const { calls } = jest.requireMock('./lib/projectManager');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls.resolve.length = 0;
  calls.load.length = 0;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
});

test('a custom slug loads the same anonymous survey and hides the dev switcher', async () => {
  window.history.replaceState({}, '', '/s/campus-study');
  render(<SurveyApp />);
  expect(await screen.findByRole('textbox', { name: 'Rater ID' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Yang et al/ })).not.toBeInTheDocument();
  await waitFor(() => expect(calls.resolve).toEqual(['campus-study']));
  expect(calls.load).toEqual(['campus']);
});

test('the project-id link still loads without resolving a slug', async () => {
  window.history.replaceState({}, '', '/survey?project=proj_legacy');
  render(<SurveyApp />);
  expect(await screen.findByRole('textbox', { name: 'Rater ID' })).toBeInTheDocument();
  expect(calls.resolve).toEqual([]);
  expect(calls.load).toEqual(['proj_legacy']);
});

test('an unknown custom link does not fall through to the default survey', async () => {
  window.history.replaceState({}, '', '/s/missing-study');
  render(<SurveyApp />);
  expect(await screen.findByText(/Survey not found/)).toBeInTheDocument();
  expect(calls.load).toEqual([]);
});
