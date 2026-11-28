/* eslint-disable import/first -- Jest mock must be declared before the router import. */
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

import { AFFILIATIONS, COLLABORATORS, LEAD, PI } from './TeamPage';

test('every affiliation number on a member is listed, and every listed affiliation is used', () => {
  const listed = AFFILIATIONS.map((a) => a.num);
  const used = [LEAD, PI, ...COLLABORATORS].flatMap((m) => m.affils);
  expect(listed).toEqual([1, 2, 3, 4, 5, 6, 7]);
  used.forEach((num) => expect(listed).toContain(num));
  listed.forEach((num) => expect(used).toContain(num));
});
