import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkFacets } from './templateTags.mjs';
import { parseFacets, withFacets, templateSource } from '../../src/lib/templateFacets.js';

describe('template facets', () => {
  it('accepts vocabulary values and free countries/cities, rejects the rest', () => {
    assert.deepEqual(checkFacets({ task: ['pairwise'], city: ['Berlin'] }).problems, []);
    assert.match(checkFacets({ task: ['vote'] }).problems.join(), /unknown value/);
    assert.match(checkFacets({ colour: ['red'] }).problems.join(), /unknown dimension/);
    assert.match(checkFacets({ source: ['paper', 'ai'] }).problems.join(), /one value/);
  });
  it('replaces facet tags and keeps other tags', () => {
    const tags = withFacets(['official', 'task:rating'], { task: ['pairwise'], concept: ['safety', 'safety'], source: ['paper'] });
    assert.deepEqual(tags, ['official', 'source:paper', 'task:pairwise', 'concept:safety']);
    assert.deepEqual(parseFacets([...tags, 'task:nonsense', 'city:Paris']), { source: ['paper'], task: ['pairwise'], concept: ['safety'], city: ['Paris'] });
  });
  it('falls back to the old category for the source', () => {
    assert.equal(templateSource({ category: 'AI Template' }), 'ai');
    assert.equal(templateSource({ category: 'Urban Theory' }), 'ai');
    assert.equal(templateSource({ name: 'SP-Scheme-Heat', category: 'Custom' }), 'ai');
    assert.equal(templateSource({ category: 'Demo' }), 'demo');
    assert.equal(templateSource({ category: 'Academic Research' }), 'paper');
    assert.equal(templateSource({ category: 'Urban Theory', tags: ['source:paper'] }), 'paper');
  });
});
