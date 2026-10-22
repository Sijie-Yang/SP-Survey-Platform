/* eslint-disable import/first -- Jest mock must be declared before the router import. */
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RegionProvider } from '../contexts/RegionContext';
import ForumPage, { relativeTime } from './ForumPage';
import * as store from '../lib/forumStore';
import { searchPattern } from '../lib/forumStore';

jest.mock('../components/layout/PublicHeader', () => ({ __esModule: true, default: () => null, PublicFooter: () => null }));
let mockUser = null;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../lib/forumStore', () => {
  const actual = jest.requireActual('../lib/forumStore');
  return {
    ...actual,
    listForumThreads: jest.fn(),
    getForumThread: jest.fn(),
    createForumThread: jest.fn(),
    replyToForumThread: jest.fn(),
    moderateForumItem: jest.fn(),
    editForumItem: jest.fn(),
    isForumAdmin: jest.fn(() => Promise.resolve(false)),
  };
});

const thread = {
  id: 't1', title: 'How many pairs per participant?', body: 'Is **12** enough?', category: 'help', status: 'open', pinned: true,
  hidden: false, authorId: 'alice', authorName: 'Alice Tan', replyCount: 1, createdAt: '2026-10-20T10:00:00Z', lastActivityAt: '2026-10-21T10:00:00Z',
};
const post = { id: 'p1', threadId: 't1', body: 'Twelve is common. ![x](https://evil.example/pixel.png)', hidden: false, authorId: 'bob', authorName: 'Bob', createdAt: '2026-10-21T10:00:00Z' };

function renderAt(path) {
  return render(
    <RegionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/forum" element={<ForumPage />} />
          <Route path="/forum/:id" element={<ForumPage />} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </RegionProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  store.isForumAdmin.mockResolvedValue(false);
});

test('lists threads for visitors and asks them to sign in to post', async () => {
  store.listForumThreads.mockResolvedValue({ threads: [thread], hasMore: false });
  renderAt('/forum');
  expect(await screen.findByText('How many pairs per participant?')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Sign in to post|登录后发帖/ })).toHaveAttribute('href', '/login?next=%2Fforum');
  fireEvent.click(screen.getByRole('button', { name: /^Closed$|^已关闭$/ }));
  await waitFor(() => expect(store.listForumThreads).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'closed', page: 0 })));
});

test('says when the forum SQL has not been run', async () => {
  const err = new Error('relation forum_threads does not exist');
  err.missingTable = true;
  store.listForumThreads.mockRejectedValue(err);
  renderAt('/forum');
  expect(await screen.findByText(/supabase\/forum\.sql/)).toBeInTheDocument();
});

test('signed-in users open a thread and land on it', async () => {
  mockUser = { id: 'alice' };
  store.listForumThreads.mockResolvedValue({ threads: [], hasMore: false });
  store.createForumThread.mockResolvedValue('t9');
  store.getForumThread.mockResolvedValue({ thread: { ...thread, id: 't9', replyCount: 0 }, posts: [] });
  renderAt('/forum');
  fireEvent.click(await screen.findByRole('button', { name: /New thread|发新帖/ }));
  fireEvent.change(screen.getByLabelText(/Title|标题/), { target: { value: 'My study' } });
  fireEvent.change(screen.getByLabelText(/^Post|^正文/), { target: { value: 'Details' } });
  // Announcements are for admins only.
  fireEvent.mouseDown(screen.getByRole('combobox'));
  const options = screen.getAllByRole('option').map((o) => o.textContent);
  expect(options).toHaveLength(5);
  expect(options.join()).not.toMatch(/Announcements|公告/);
  fireEvent.click(screen.getAllByRole('option')[0]);
  fireEvent.click(screen.getByRole('button', { name: /^Post$|^发布$/ }));
  await waitFor(() => expect(store.createForumThread).toHaveBeenCalledWith(expect.objectContaining({ title: 'My study', body: 'Details', category: 'general' })));
  expect(await screen.findByTestId('forum-thread')).toBeInTheDocument();
});

test('thread page: replies render without loading outside images; the author can close it', async () => {
  mockUser = { id: 'alice' };
  store.getForumThread.mockResolvedValue({ thread, posts: [post] });
  store.moderateForumItem.mockResolvedValue(null);
  renderAt('/forum/t1');
  expect(await screen.findByTestId('forum-thread')).toHaveTextContent('Is 12 enough?');
  const reply = screen.getByTestId('forum-post');
  expect(reply.querySelector('img')).toBeNull();
  expect(reply.querySelector('a[href="https://evil.example/pixel.png"]')).not.toBeNull();
  expect(screen.getByTestId('forum-reply-box')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: /More actions|更多操作/ })[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: /Close thread|关闭帖子/ }));
  await waitFor(() => expect(store.moderateForumItem).toHaveBeenCalledWith('thread', 't1', 'close'));
  // Alice is not an admin: no pin option.
  fireEvent.click(screen.getAllByRole('button', { name: /More actions|更多操作/ })[0]);
  expect(screen.queryByRole('menuitem', { name: /Pin|置顶/ })).not.toBeInTheDocument();
});

test('closed threads refuse new replies from members', async () => {
  mockUser = { id: 'bob' };
  store.getForumThread.mockResolvedValue({ thread: { ...thread, status: 'closed' }, posts: [post] });
  renderAt('/forum/t1');
  expect(await screen.findByText(/This thread is closed|这个帖子已关闭/)).toBeInTheDocument();
  expect(screen.queryByTestId('forum-reply-box')).not.toBeInTheDocument();
  // Bob may delete his own reply but cannot close Alice's thread.
  expect(screen.getAllByRole('button', { name: /More actions|更多操作/ })).toHaveLength(1);
});

test('admins can pin and hide', async () => {
  mockUser = { id: 'admin' };
  store.isForumAdmin.mockResolvedValue(true);
  store.getForumThread.mockResolvedValue({ thread: { ...thread, pinned: false }, posts: [post] });
  store.moderateForumItem.mockResolvedValue(null);
  renderAt('/forum/t1');
  await screen.findByTestId('forum-thread');
  await waitFor(() => expect(store.isForumAdmin).toHaveBeenCalled());
  fireEvent.click(screen.getAllByRole('button', { name: /More actions|更多操作/ })[0]);
  fireEvent.click(await screen.findByRole('menuitem', { name: /Pin to top|置顶/ }));
  await waitFor(() => expect(store.moderateForumItem).toHaveBeenCalledWith('thread', 't1', 'pin'));
});

test('helpers', () => {
  expect(searchPattern('  street  safety ')).toBe('%street safety%');
  expect(searchPattern('a,b(c)%_')).toBe('%a b c%');
  expect(searchPattern('')).toBe('');
  const now = Date.parse('2026-10-22T12:00:00Z');
  expect(relativeTime('2026-10-22T11:00:00Z', 'en', now)).toBe('1 hour ago');
  expect(relativeTime('2026-10-20T12:00:00Z', 'en', now)).toBe('2 days ago');
});
