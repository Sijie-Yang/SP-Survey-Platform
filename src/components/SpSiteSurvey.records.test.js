import React from 'react';
import { render, screen } from '@testing-library/react';
import { Model } from 'survey-core';
import SpSiteSurvey, { SP_SITE_DEFAULT_COMPLETE_ON, captureRecord, completesOn } from './SpSiteSurvey';

test('a captured request is trimmed to a sane record', () => {
  const rec = captureRecord({ kind: 'fetch', url: '/api/save?x=1', method: 'POST', data: { a: 1 } }, '2026-10-14T00:00:00.000Z');
  expect(rec).toEqual({ at: '2026-10-14T00:00:00.000Z', kind: 'fetch', method: 'POST', url: '/api/save?x=1', data: { a: 1 } });
  const big = captureRecord({ url: '/x', method: 'POST', data: { text: 'y'.repeat(30000) } });
  expect(big.data.truncated).toBe(true);
});

test('the page\'s own finish request completes a raw-mode survey', () => {
  expect(completesOn('/api/finish?session=1', undefined)).toBe(true);
  expect(completesOn('/api/save', undefined)).toBe(false);
  expect(completesOn('/api/save', 'save$')).toBe(true);
  expect(completesOn('/api/finish', 'never')).toBe(false);
  expect(completesOn('/api/finish', '(')).toBe(false);
  expect(SP_SITE_DEFAULT_COMPLETE_ON).toMatch(/finish/);
});

test('with no questions declared the platform shows its own submit bar', () => {
  const json = { pages: [], spSite: { html: '<html><body>page</body></html>' } };
  render(<SpSiteSurvey model={new Model(json)} surveyJson={json} language="zh" />);
  expect(screen.getByTestId('sp-site-raw-bar').textContent).toContain('原样记录');
  expect(screen.getByRole('button', { name: '完成并提交' })).toBeTruthy();
});

test('with questions declared there is no submit bar', () => {
  const json = { pages: [{ name: 'p', elements: [{ type: 'text', name: 'a' }] }], spSite: { html: '<html><body>page</body></html>' } };
  render(<SpSiteSurvey model={new Model(json)} surveyJson={json} language="en" />);
  expect(screen.queryByTestId('sp-site-raw-bar')).toBeNull();
});
