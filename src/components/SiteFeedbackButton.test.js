import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RegionProvider } from '../contexts/RegionContext';
import SiteFeedbackButton from './SiteFeedbackButton';
import SiteFeedbackManagement, { feedbackToCsv } from './admin/SiteFeedbackManagement';
import { listSiteFeedback, submitSiteFeedback, updateSiteFeedback } from '../lib/siteFeedback';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../lib/siteFeedback', () => ({
  ...jest.requireActual('../lib/siteFeedback'),
  submitSiteFeedback: jest.fn(),
  listSiteFeedback: jest.fn(),
  updateSiteFeedback: jest.fn(),
  deleteSiteFeedback: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.setItem('sp-survey-language', 'zh');
});

test('anonymous visitor can send a suggestion with optional WeChat ID', async () => {
  submitSiteFeedback.mockResolvedValue('id-1');
  render(<RegionProvider><SiteFeedbackButton /></RegionProvider>);
  fireEvent.click(screen.getByRole('button', { name: '提建议' }));
  expect(screen.getByText(/不登录也可以提/)).toBeInTheDocument();
  const submit = screen.getByRole('button', { name: '提交' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/你的建议/), { target: { value: '希望支持视频问卷' } });
  fireEvent.change(screen.getByLabelText('微信号'), { target: { value: 'wx_peter' } });
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByText(/你的建议已经发给/)).toBeInTheDocument());
  expect(submitSiteFeedback).toHaveBeenCalledWith(expect.objectContaining({
    message: '希望支持视频问卷', contactWechat: 'wx_peter', website: '', category: 'suggestion',
  }));
});

test('rate-limited sends show a friendly message', async () => {
  submitSiteFeedback.mockRejectedValue(Object.assign(new Error('Too many'), { rateLimited: true }));
  render(<RegionProvider><SiteFeedbackButton /></RegionProvider>);
  fireEvent.click(screen.getByRole('button', { name: '提建议' }));
  fireEvent.change(screen.getByLabelText(/你的建议/), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  expect(await screen.findByText(/请稍等一会儿再试/)).toBeInTheDocument();
});

const rows = [
  { id: 'a', createdAt: '2026-10-20T03:00:00Z', category: 'bug', message: '导出按钮没反应', userEmail: 'r@x.org', contactWechat: '', contactEmail: '', contactName: '', contactOther: '', status: 'new', adminNote: '' },
  { id: 'b', createdAt: '2026-10-19T03:00:00Z', category: 'suggestion', message: '多一点模板', userEmail: '', contactWechat: 'wx1', contactEmail: '', contactName: '', contactOther: '', status: 'done', adminNote: '' },
];

test('admin list shows open items and marks a new one read when opened', async () => {
  listSiteFeedback.mockResolvedValue(rows);
  updateSiteFeedback.mockResolvedValue({ status: 'read', adminNote: '', updatedAt: 'now' });
  render(<SiteFeedbackManagement />);
  expect(await screen.findByText('导出按钮没反应')).toBeInTheDocument();
  expect(screen.queryByText('多一点模板')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('导出按钮没反应'));
  await waitFor(() => expect(updateSiteFeedback).toHaveBeenCalledWith('a', { status: 'read' }));
  await waitFor(() => expect(screen.getAllByText('已读').length).toBeGreaterThan(0));
});

test('admin shows the setup hint when the SQL has not been run', async () => {
  listSiteFeedback.mockRejectedValue(Object.assign(new Error('missing'), { missingTable: true }));
  render(<SiteFeedbackManagement />);
  expect(await screen.findByText(/site_feedback\.sql/)).toBeInTheDocument();
});

test('CSV export escapes commas, quotes and newlines', () => {
  const csv = feedbackToCsv([{ ...rows[0], message: 'a, "b"\nc' }]);
  expect(csv.split('\n')[0]).toMatch(/^created_at,status,category,message/);
  expect(csv).toContain('"a, ""b""\nc"');
});
