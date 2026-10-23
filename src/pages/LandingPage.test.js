/* eslint-disable import/first -- Jest mock must be declared before the router import. */
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

import { isSpSchemeTemplate } from './LandingPage';

test('SP-Scheme examples are recognised by name or id', () => {
  expect(isSpSchemeTemplate({ name: 'SP-Scheme: Street safety' })).toBe(true);
  expect(isSpSchemeTemplate({ name: 'SP Scheme demo' })).toBe(true);
  expect(isSpSchemeTemplate({ name: 'Street walkability', id: 'sp-scheme-walk' })).toBe(true);
  expect(isSpSchemeTemplate({ name: 'spscheme greenery' })).toBe(true);
  expect(isSpSchemeTemplate({ name: 'Place Pulse 2.0', id: '2016-dubey-place' })).toBe(false);
  expect(isSpSchemeTemplate({ name: 'SP-Survey thermal comfort' })).toBe(false);
  expect(isSpSchemeTemplate(null)).toBe(false);
});
