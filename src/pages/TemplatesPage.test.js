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

test('newest first: year, then time online; admin pin does not reorder', () => {
  const sorted = sortNewestFirst([
    { id: 'old', year: 2016, created_at: '2026-11-20' },
    { id: 'new-early', year: 2026, created_at: '2026-01-01' },
    { id: 'new-late', year: 2026, created_at: '2026-11-26' },
    { id: 'pinned', year: 2013, is_pinned: true },
  ]);
  expect(sorted.map((t) => t.id)).toEqual(['new-late', 'new-early', 'old', 'pinned']);
});

test('rows show short author lists and search also finds the paper title and journal', () => {
  const { shortAuthors } = require('../components/templates/TemplateLibrary');
  expect(shortAuthors(['Ito K.', 'Biljecki F.'])).toBe('Ito & Biljecki');
  expect(shortAuthors(['Lurong Xu', 'Shuli Luo', 'Alexa Delbosc', "Steve O'Hern"])).toBe('Xu et al.');
  expect(shortAuthors(['Costa M.', 'Azevedo C.L.', 'Moura F.'])).toBe('Costa, Azevedo & Moura');
  expect(shortAuthors(['Ito, Koichi'])).toBe('Ito');
  expect(shortAuthors([])).toBe('');
  const withPaper = [{ id: 'x', name: 'Bikeability', category: 'urban', paper: { title: 'Assessing bikeability with street view imagery', venue: 'Transportation Research Part C', authors: ['Ito K.'] } }];
  expect(filterTemplates(withPaper, 'all', 'transportation research').length).toBe(1);
  expect(filterTemplates(withPaper, 'all', 'street view imagery').length).toBe(1);
});
