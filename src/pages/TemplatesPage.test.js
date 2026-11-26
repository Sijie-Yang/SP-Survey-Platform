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

test('source buttons and dropdowns filter the library; demos only under Demo', () => {
  const tagged = [
    { id: 'a', name: 'Place Pulse', author: 'Dubey', year: 2016, rawCategory: 'Academic Research', tags: ['task:pairwise', 'concept:safety', 'country:USA'] },
    { id: 'b', name: 'Street greenery', author: 'Li', year: 2025, rawCategory: 'Academic Research', tags: ['task:rating', 'concept:greenery'] },
    { id: 'c', name: 'SP-Scheme: Walkability', year: 2026, rawCategory: 'Custom', tags: [] },
    { id: 'd', name: 'Gehl criteria', year: 2010, rawCategory: 'Urban Theory', tags: ['task:multi_rating'] },
    { id: 'e', name: 'Cats', year: 2026, rawCategory: 'Demo', tags: ['task:pairwise'] },
  ];
  const ids = (f) => filterTemplates(tagged, f).map((t) => t.id);
  expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  expect(ids({ source: 'paper' })).toEqual(['a', 'b']);
  expect(ids({ source: 'ai' })).toEqual(['c', 'd']);
  expect(ids({ source: 'demo' })).toEqual(['e']);
  expect(ids({ task: 'pairwise' })).toEqual(['a']);
  expect(ids({ source: 'demo', task: 'pairwise' })).toEqual(['e']);
  expect(ids({ concept: 'greenery', task: 'pairwise' })).toEqual([]);
  expect(ids({ country: 'USA' })).toEqual(['a']);
});

test('search matches name, author and year', () => {
  expect(filterTemplates(list, { q: 'dubey' }).map((t) => t.id)).toEqual(['a']);
  expect(filterTemplates(list, { q: '2025' }).map((t) => t.id)).toEqual(['b']);
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
  expect(filterTemplates(withPaper, { q: 'transportation research' }).length).toBe(1);
  expect(filterTemplates(withPaper, { q: 'street view imagery' }).length).toBe(1);
});

test('one public name: the paper title when linked; change requests name the template', () => {
  const { templateDisplayName } = require('../components/templates/TemplateLibrary');
  const { templateChangeMessage } = require('../components/templates/TemplateChangeRequestDialog');
  expect(templateDisplayName({ name: 'Bikeability', paper: { title: 'Assessing bikeability with street view imagery' } }))
    .toBe('Assessing bikeability with street view imagery');
  expect(templateDisplayName({ name: 'QA Template', paper: null })).toBe('QA Template');
  const msg = templateChangeMessage({ template: { id: '2021-ito-assessing' }, title: 'Assessing bikeability', role: 'author', change: 'Use our images', links: 'https://osf.io/x' });
  expect(msg).toContain('2021-ito-assessing');
  expect(msg).toContain('作者 Author');
  expect(msg).toContain('https://osf.io/x');
  expect(templateChangeMessage({ template: { id: 'a' }, title: 'A', role: 'other', change: 'x', links: '' })).not.toContain('Original materials');
});
