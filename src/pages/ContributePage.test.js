import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContributePage from './ContributePage';
import ContentSubmissionManagement from '../components/admin/ContentSubmissionManagement';
import WikiMarkdown, { safeWikiUrl } from '../components/docs/WikiMarkdown';
import { builtinWikiSource, wikiDocuments } from '../lib/wikiSource';
import * as store from '../lib/contentSubmissionStore';

let mockUser = null;
let mockParams = new URLSearchParams();
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('../contexts/RegionContext', () => ({ useRegion: () => ({ language: 'en' }) }));
jest.mock('../components/layout/PublicHeader', () => ({ __esModule: true, default: () => null, PublicFooter: () => null }));
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [mockParams],
  useNavigate: () => jest.fn(),
  Link: require('react').forwardRef(({ children, to, ...rest }, ref) => <a ref={ref} href={to} {...rest}>{children}</a>),
}), { virtual: true });
jest.mock('../lib/contentSubmissionStore', () => ({ getWikiPage: jest.fn(), listSubmissions: jest.fn(), listWikiPages: jest.fn(), saveSubmission: jest.fn(), reviewSubmission: jest.fn(), submissionHistory: jest.fn() }));
const source = builtinWikiSource('visual-assessment','en');
const submission = { id: 'test-id', user_id: 'alice', kind: 'doc_edit', target_key: 'visual-assessment', language: 'en', title: 'Proposed title', summary: 'New summary', body: 'A thoughtful revised article, ready for review.', contributor_name: 'Alice', change_reason: 'Clarifying the terminology.', source_notes: 'Public research', version: 1, status: 'pending', rights_confirmed: true, base_revision: 0, base_content: source, updated_at: '2026-10-05T00:00:00Z' };
beforeEach(() => {
  jest.clearAllMocks(); mockUser = null; mockParams = new URLSearchParams();
  Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => 'test-id' } });
  window.scrollTo = jest.fn();
  store.getWikiPage.mockResolvedValue(null); store.listWikiPages.mockResolvedValue([]); store.listSubmissions.mockResolvedValue([]); store.submissionHistory.mockResolvedValue([]);
});
afterEach(async () => { await act(async () => {}); });
test('every built-in page supplies editable text in both languages', () => {
  for (const language of ['en','zh']) for (const doc of wikiDocuments(language)) {
    const text = builtinWikiSource(doc.key,language);
    expect(text.title.length).toBeGreaterThan(0);
    expect(text.body.length).toBeGreaterThan(20);
    expect(text.body).not.toMatch(/undefined|\[object Object\]/);
  }
});
test('visitors can read guidelines and sign in with their original edit destination', () => {
  mockParams = new URLSearchParams('kind=doc_edit&target=visual-assessment');
  render(<ContributePage />);
  expect(screen.getByRole('link', {name:'Read submission guidelines'})).toHaveAttribute('href','/docs/doc-news-submission');
  expect(decodeURIComponent(screen.getByRole('link', {name:'Sign in / register'}).getAttribute('href'))).toContain('/contribute?kind=doc_edit&target=visual-assessment');
  expect(screen.queryByRole('button', {name:'Submit for review'})).not.toBeInTheDocument();
  expect(store.listSubmissions).not.toHaveBeenCalled();
});
test('signed-in editors load current text and submit an explicitly versioned proposal', async () => {
  mockUser = {id:'alice'}; mockParams = new URLSearchParams('kind=doc_edit&target=visual-assessment');
  let resolveSave; store.saveSubmission.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  render(<ContributePage />);
  await waitFor(() => expect(screen.getByLabelText('Title', {exact:false})).toHaveValue(source.title));
  fireEvent.change(screen.getByLabelText('Title', {exact:false}), {target:{value:submission.title}});
  fireEvent.change(screen.getByLabelText(/Public contributor name/), {target:{value:'Alice'}});
  fireEvent.change(screen.getByLabelText(/Change \/ submission rationale/), {target:{value:submission.change_reason}});
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button', {name:'Submit for review'}).closest('form'));
  expect(store.saveSubmission).toHaveBeenCalledWith('test-id',0,expect.objectContaining({title:submission.title,base_revision:0,base_content:expect.objectContaining({body:source.body}),rights_confirmed:true}));
  expect(screen.getByLabelText(/Body \(Markdown\)/)).toBeDisabled();
  await act(async () => resolveSave(submission));
  expect(await screen.findByText(/Submitted. Publication requires/)).toBeInTheDocument();
  expect(store.listSubmissions).toHaveBeenCalledWith({userId:'alice'});
});
test('switching accounts clears the previous author’s private editor', async () => {
  mockUser = {id:'alice'};
  const view = render(<ContributePage />);
  fireEvent.change(screen.getByLabelText(/Body \(Markdown\)/),{target:{value:'Private unpublished text'}});
  mockUser = {id:'bob'}; view.rerender(<ContributePage />);
  expect(screen.getByLabelText(/Body \(Markdown\)/)).toHaveValue('');
  await waitFor(() => expect(store.listSubmissions).toHaveBeenCalledWith({userId:'bob'}));
});
test('a conflict retains the proposal and rebase updates only the source snapshot', async () => {
  mockUser = {id:'alice'}; store.listSubmissions.mockResolvedValue([submission]);
  store.saveSubmission.mockRejectedValue(Object.assign(new Error('Conflict'),{code:'40001'}));
  render(<ContributePage />);
  fireEvent.click(await screen.findByRole('button',{name:'Open / revise and resubmit'}));
  fireEvent.submit(screen.getByRole('button',{name:'Submit for review'}).closest('form'));
  expect(await screen.findByText(/The content or review status changed/)).toBeInTheDocument();
  store.getWikiPage.mockResolvedValue({...source,body:'New public revision to merge.',revision:2});
  fireEvent.click(screen.getByRole('button',{name:'Load latest source to merge'}));
  expect(await screen.findByText(/Latest source loaded/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Body \(Markdown\)/)).toHaveValue(submission.body);
  fireEvent.submit(screen.getByRole('button',{name:'Submit for review'}).closest('form'));
  await waitFor(()=>expect(store.saveSubmission).toHaveBeenLastCalledWith('test-id',1,expect.objectContaining({base_revision:2,body:submission.body})));
});
test('moderators compare real current text and approve the exact submission version', async () => {
  store.listSubmissions.mockResolvedValue([submission]); store.reviewSubmission.mockResolvedValue({...submission,status:'approved'});
  render(<ContentSubmissionManagement />);
  fireEvent.click(await screen.findByRole('button',{name:'查看内容与审核'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'审核通过并发布'})).toBeEnabled());
  expect(screen.getByText('当前公开原文')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'审核通过并发布'}));
  await waitFor(()=>expect(store.reviewSubmission).toHaveBeenCalledWith(submission,'approved',''));
});
test('changed source blocks approval and requires feedback for returning a proposal', async () => {
  store.listSubmissions.mockResolvedValue([submission]); store.getWikiPage.mockResolvedValue({...source,revision:1});
  render(<ContentSubmissionManagement />);
  fireEvent.click(await screen.findByRole('button',{name:'查看内容与审核'}));
  expect(await screen.findByText(/原文已更新或无法确认/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'审核通过并发布'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'退回修改'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/审核反馈/),{target:{value:'请合并最新文档后再投稿。'}});
  fireEvent.click(screen.getByRole('button',{name:'退回修改'}));
  await waitFor(()=>expect(store.reviewSubmission).toHaveBeenCalledWith(submission,'changes_requested','请合并最新文档后再投稿。'));
});
test('Markdown shows tables and images, discarding executable HTML and unsafe URL schemes', () => {
  const {container} = render(<WikiMarkdown body={'# Guide\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![Preview](/docs/research/preview.png)\n\n[safe](https://example.org/paper)\n\n[bad](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://example.org" />'} />);
  expect(screen.getByRole('heading',{name:'Guide',level:2})).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByAltText('Preview')).toHaveAttribute('src','/docs/research/preview.png');
  expect(container.querySelector('script,iframe,[onerror]')).toBeNull();
  expect(screen.getByText('bad').getAttribute('href') || '').not.toMatch(/javascript/i);
  for (const url of ['javascript:alert(1)','data:text/html,test','//evil.test','/\\evil.test',' https://example.org','https://example.org\n']) expect(safeWikiUrl(url)).toBe('');
});
