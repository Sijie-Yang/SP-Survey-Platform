import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectAssistantBinding } from './credentials.mjs';
import {
  applySubsidyToDirectory,
  isSubsidyActive,
  normalizeSubsidyRoutes,
  publicSubsidyView,
  subsidyAllowsRoute,
} from './subsidy.mjs';

const now = Date.parse('2026-09-17T12:00:00.000Z');

describe('assistant subsidy policy', () => {
  it('normalizes provider/model pairs and drops blanks', () => {
    assert.deepEqual(normalizeSubsidyRoutes([
      { provider: 'qwen-dashscope', model: 'qwen-plus' },
      { provider: 'qwen-dashscope', model: 'qwen-plus' },
      { provider: '', model: 'x' },
      { model: 'y' },
    ]), [{ provider: 'qwen-dashscope', model: 'qwen-plus' }]);
  });

  it('moves saved routes off retired model ids to their successors', () => {
    assert.deepEqual(normalizeSubsidyRoutes([
      { provider: 'qwen-dashscope', model: 'deepseek-v3.2' },
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'deepseek', model: 'deepseek-v4-flash-vision-exp' },
      { provider: 'my-proxy', model: 'local-model' },
    ]), [
      { provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' },
      { provider: 'deepseek', model: 'deepseek-flash' },
      { provider: 'my-proxy', model: 'local-model' },
    ]);
  });

  it('treats missing donor, empty routes, or expiry as inactive', () => {
    assert.equal(isSubsidyActive({
      enabled: true,
      donor_user_id: 'admin-1',
      allowed_routes: [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }],
    }, now), true);
    assert.equal(isSubsidyActive({
      enabled: true,
      donor_user_id: 'admin-1',
      allowed_routes: [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }],
      expires_at: '2026-09-17T11:00:00.000Z',
    }, now), false);
    assert.equal(isSubsidyActive({
      enabled: true,
      donor_user_id: null,
      allowed_routes: [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }],
    }, now), false);
    assert.equal(isSubsidyActive({
      enabled: false,
      donor_user_id: 'admin-1',
      allowed_routes: [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }],
    }, now), false);
  });

  it('only allows exact subsidized routes while active', () => {
    const row = {
      enabled: true,
      donor_user_id: 'admin-1',
      allowed_routes: [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }],
    };
    assert.equal(subsidyAllowsRoute(row, 'qwen-dashscope', 'deepseek-v4.1-flash', now), true);
    assert.equal(subsidyAllowsRoute(row, 'qwen-dashscope', 'qwen-vl-max', now), false);
    assert.equal(subsidyAllowsRoute({ ...row, expires_at: '2026-09-17T11:00:00.000Z' }, 'qwen-dashscope', 'deepseek-v4.1-flash', now), false);
  });

  it('exposes only allowed models as shared and keeps user-owned providers intact', () => {
    const directory = [
      {
        id: 'qwen-dashscope',
        displayName: 'Qwen DashScope',
        configured: false,
        userConfigured: false,
        models: [],
      },
      {
        id: 'deepseek',
        displayName: 'DeepSeek',
        configured: true,
        userConfigured: true,
        models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat' }],
      },
    ];
    const subsidy = {
      enabled: true,
      donor_user_id: 'admin-1',
      allowed_routes: [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }],
    };
    const { directory: next, subsidizedRoutes } = applySubsidyToDirectory(directory, subsidy, {}, now);
    const qwen = next.find((item) => item.id === 'qwen-dashscope');
    const deepseek = next.find((item) => item.id === 'deepseek');
    assert.equal(qwen.shared, true);
    assert.equal(qwen.userConfigured, false);
    assert.equal(qwen.configured, true);
    assert.ok(qwen.models.some((model) => model.id === 'deepseek-v4.1-flash' && model.shared));
    assert.equal(qwen.models.some((model) => model.id === 'qwen-vl-max'), false);
    assert.equal(deepseek.userConfigured, true);
    assert.equal(deepseek.shared, undefined);
    assert.deepEqual(subsidizedRoutes, [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash', shared: true }]);
    assert.deepEqual(publicSubsidyView(subsidy, now).routes, [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }]);
  });

  it('binds subsidy credentials to the donor route, not the receiver override', () => {
    const subsidy = {
      enabled: true,
      donor_user_id: 'admin-1',
      allowed_routes: [{ provider: 'qwen-dashscope', model: 'deepseek-v4.1-flash' }],
    };
    const donor = { provider: 'qwen-dashscope', base_url: 'https://donor.example/v1', protocol: 'openai-completions' };
    const receiver = { provider: 'qwen-dashscope', base_url: 'https://receiver.example/v1', protocol: 'openai-responses' };
    const shared = selectAssistantBinding({
      userCred: null,
      subsidy,
      provider: 'qwen-dashscope',
      model: 'deepseek-v4.1-flash',
      receiverProfile: receiver,
      donorProfile: donor,
    });
    assert.equal(shared.source, 'subsidy');
    assert.equal(shared.profile.base_url, 'https://donor.example/v1');
    assert.equal(shared.profile.protocol, 'openai-completions');

    const personal = selectAssistantBinding({
      userCred: { apiKey: 'sk-user', provider: 'qwen-dashscope' },
      subsidy,
      provider: 'qwen-dashscope',
      model: 'deepseek-v4.1-flash',
      receiverProfile: receiver,
      donorProfile: donor,
    });
    assert.equal(personal.source, 'user');
    assert.equal(personal.profile.base_url, 'https://receiver.example/v1');

    const custom = selectAssistantBinding({
      userCred: null,
      subsidy: {
        ...subsidy,
        allowed_routes: [{ provider: 'my-proxy', model: 'local-model' }],
      },
      provider: 'my-proxy',
      model: 'local-model',
      receiverProfile: { provider: 'my-proxy', base_url: 'https://evil.example' },
      donorProfile: { provider: 'my-proxy', base_url: 'https://approved.example' },
    });
    assert.equal(custom.source, 'subsidy');
    assert.equal(custom.profile.base_url, 'https://approved.example');
  });
});
