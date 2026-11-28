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
    assert.deepEqual(tags, ['official', 'source:paper', 'concept:safety', 'task:pairwise']);
    assert.deepEqual(parseFacets([...tags, 'task:nonsense', 'city:Paris']), { source: ['paper'], concept: ['safety'], task: ['pairwise'], city: ['Paris'] });
  });
  it('reads and accepts tags of the earlier vocabulary as today\'s tags', () => {
    assert.deepEqual(
      parseFacets(['task:multi_rating', 'task:rating', 'participants:crowd', 'modality:vr', 'concept:aesthetics', 'concept:building_facade', 'task:custom_page', 'sample:100to1000']),
      { task: ['rating'], participants: ['public'], setting: ['online', 'vr'], concept: ['beauty'], scene: ['building'] },
    );
    const { clean, added, problems } = checkFacets({ participants: ['crowd'], task: ['map_annotation'], sample: ['300to500'] });
    assert.deepEqual(problems, []);
    assert.deepEqual(clean, { participants: ['public'], task: ['annotation'], sample: ['300to500'] });
    assert.deepEqual(added, { setting: ['online'] });
    // templates do not carry the papers-only dimensions
    assert.match(checkFacets({ team_org: ['MIT'] }).problems.join(), /unknown dimension/);
    assert.deepEqual(withFacets([], { team_org: ['MIT'], scene: ['street'] }), ['scene:street']);
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
