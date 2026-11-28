import test from 'node:test';
import assert from 'node:assert/strict';
import { publicTemplateFromRow, stripOwnResponseSupabase } from './publicTemplates.mjs';

test('a public template carries no submitter and no response-database keys', () => {
  const out = publicTemplateFromRow({
    id: '2016-dubey-place',
    name: 'Place Pulse 2.0',
    user_id: 'u1',
    submitter_email: 'someone@example.org',
    survey_config: { title: 'T', ownResponseSupabase: { url: 'x', anonKey: 'y' }, pages: [{ own_response_supabase: 1, name: 'p' }] },
    image_dataset_config: { folders: {}, OwnResponseSupabase: { url: 'x' } },
    preloaded_images: [{ name: 'a.jpg', url: 'https://media.example/a.jpg' }],
    updated_at: '2026-11-27T00:00:00Z',
  }, { title: 'Deep Learning the City', authors: ['Dubey A.'], year: 2016, venue: 'ECCV', doi: '10.1007/978-3-319-46448-0_12' });
  const text = JSON.stringify(out);
  assert.ok(!text.includes('someone@example.org'));
  assert.ok(!text.includes('u1'));
  assert.ok(!/ownresponsesupabase|own_response_supabase/i.test(text));
  assert.equal(out.config.pages[0].name, 'p');
  assert.equal(out.preloadedImages.length, 1);
  assert.equal(out.paper.url, 'https://doi.org/10.1007/978-3-319-46448-0_12');
  assert.equal(out.isApproved, true);
});

test('a template without a paper has paper null', () => {
  assert.equal(publicTemplateFromRow({ id: 'x' }).paper, null);
  assert.deepEqual(stripOwnResponseSupabase([{ a: 1 }]), [{ a: 1 }]);
});
