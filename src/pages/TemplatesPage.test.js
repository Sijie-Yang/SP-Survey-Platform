/* eslint-disable import/first -- Jest mock must be declared before the router import. */
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

import { filterTemplates } from './TemplatesPage';
import { sortNewestFirst } from '../components/templates/TemplateLibrary';

const list = [
  { id: 'a', name: 'Place Pulse', author: 'Dubey', year: 2016, category: 'academic' },
  { id: 'b', name: 'Street greenery', author: 'Li', year: 2025, category: 'urban' },
  { id: 'c', name: 'SP-Scheme: Walkability', year: 2026, category: 'ai' },
  { id: 'd', name: 'AI image rating', year: 2024, category: 'ai' },
];

test('type buttons split the library; SP-Scheme examples only under SP-Scheme', () => {
  expect(filterTemplates(list, 'all', '').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(filterTemplates(list, 'ai', '').map((t) => t.id)).toEqual(['d']);
  expect(filterTemplates(list, 'scheme', '').map((t) => t.id)).toEqual(['c']);
  expect(filterTemplates(list, 'nonsense', '').length).toBe(4);
});

test('search matches name, author and year', () => {
  expect(filterTemplates(list, 'all', 'dubey').map((t) => t.id)).toEqual(['a']);
  expect(filterTemplates(list, 'all', '2025').map((t) => t.id)).toEqual(['b']);
  expect(filterTemplates(list, 'urban', 'pulse')).toEqual([]);
});

test('newest first: pinned, then year, then time online', () => {
  const sorted = sortNewestFirst([
    { id: 'old', year: 2016, created_at: '2026-11-20' },
    { id: 'new-early', year: 2026, created_at: '2026-01-01' },
    { id: 'new-late', year: 2026, created_at: '2026-11-26' },
    { id: 'pinned', year: 2013, is_pinned: true },
  ]);
  expect(sorted.map((t) => t.id)).toEqual(['pinned', 'new-late', 'new-early', 'old']);
});
