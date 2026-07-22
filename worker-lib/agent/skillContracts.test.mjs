import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateSkillContracts } from './skillContracts.mjs';

const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' };

test('survey save freezes current Skill revision/schema and strips HTML', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    assert.match(String(url), /question_skills/);
    return new Response(JSON.stringify([{
      id: 'skill_a', user_id: 'u1', is_approved: false, current_revision: 4,
      contract_version: 1, result_schema: [{ key: 'score', type: 'number' }],
    }]), { status: 200 });
  };
  const result = await hydrateSkillContracts(env, {
    pages: [{ elements: [{ type: 'skillquestion', name: 'q', skillId: 'skill_a', skillHtml: '<html />' }] }],
  }, 'u1');
  const question = result.pages[0].elements[0];
  assert.equal(question.skillRevision, 4);
  assert.equal(question.skillContractVersion, 1);
  assert.deepEqual(question.skillResultSchema, [{ key: 'score', type: 'number' }]);
  assert.equal('skillHtml' in question, false);
});

test('preset_* questions receive resultSchema snapshots without network', async () => {
  const result = await hydrateSkillContracts(env, {
    pages: [{
      elements: [{
        type: 'skillquestion',
        name: 'q',
        skillId: 'preset_image_preference_forced',
        skillHtml: '<html />',
      }],
    }],
  }, 'u1');
  const question = result.pages[0].elements[0];
  assert.equal('skillHtml' in question, false);
  assert.equal(question.skillRevision, 1);
  assert.ok(Array.isArray(question.skillResultSchema));
  assert.equal(question.skillResultSchema[0]?.key, 'choice');
});

test('requested historical revision is loaded instead of current', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    if (String(url).includes('question_skill_versions')) {
      return new Response(JSON.stringify([{
        skill_id: 'skill_a', revision: 2, contract_version: 1,
        result_schema: [{ key: 'old', type: 'boolean' }],
      }]), { status: 200 });
    }
    return new Response(JSON.stringify([{
      id: 'skill_a', user_id: 'u1', is_approved: false, current_revision: 4,
      contract_version: 1, result_schema: [{ key: 'new', type: 'number' }],
    }]), { status: 200 });
  };
  const result = await hydrateSkillContracts(env, {
    pages: [{ elements: [{ type: 'skillquestion', name: 'q', skillId: 'skill_a', skillRevision: 2 }] }],
  }, 'u1');
  assert.deepEqual(result.pages[0].elements[0].skillResultSchema, [{ key: 'old', type: 'boolean' }]);
});

