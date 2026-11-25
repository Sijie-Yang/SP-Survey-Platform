import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeTransferId,
  signTransferToken,
  stagingKey,
  verifyTransferToken,
} from './transferTokens.mjs';

const env = { SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' };
const T0 = Date.UTC(2026, 10, 25, 12, 0, 0);

describe('signed MCP transfer links', () => {
  it('round-trips an upload and a download token with their claims', async () => {
    const up = await signTransferToken(env, { kind: 'upload', userId: 'u1', uploadId: 'abc-123-def' }, 1800, T0);
    assert.equal(up.expiresAt, new Date(T0 + 1800 * 1000).toISOString());
    const claims = await verifyTransferToken(env, up.token, 'upload', T0 + 1000);
    assert.deepEqual({ ...claims }, { kind: 'upload', userId: 'u1', uploadId: 'abc-123-def', expiresAt: up.expiresAt });

    const down = await signTransferToken(env, { kind: 'download', userId: 'u1', projectId: 'proj_1_abc', includePractice: true }, 900, T0);
    const d = await verifyTransferToken(env, down.token, 'download', T0);
    assert.equal(d.projectId, 'proj_1_abc');
    assert.equal(d.includePractice, true);
  });

  it('never contains either secret, and the payload is not a credential by itself', async () => {
    const { token } = await signTransferToken({ MCP_SIGNING_SECRET: 'explicit-signing-secret', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, { kind: 'upload', userId: 'u1', uploadId: 'abcdefgh' }, 60, T0);
    assert.doesNotMatch(token, /secret/);
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    assert.deepEqual(Object.keys(payload).sort(), ['exp', 'id', 'k', 'u']);
  });

  it('rejects expired, tampered, re-signed and wrong-kind tokens', async () => {
    const { token } = await signTransferToken(env, { kind: 'upload', userId: 'u1', uploadId: 'abcdefgh' }, 60, T0);
    await assert.rejects(verifyTransferToken(env, token, 'upload', T0 + 61 * 1000), (err) => err.status === 401 && err.code === 'LINK_EXPIRED');
    await assert.rejects(verifyTransferToken(env, token, 'download', T0), (err) => err.status === 401);

    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'upload', u: 'u2', id: 'abcdefgh', exp: 9999999999 })).toString('base64url');
    await assert.rejects(verifyTransferToken(env, `${forged}.${sig}`, 'upload', T0), (err) => err.status === 401);
    const flipped = sig.slice(0, -2) + (sig.at(-2) === 'A' ? 'B' : 'A') + sig.at(-1);
    await assert.rejects(verifyTransferToken(env, `${body}.${flipped}`, 'upload', T0), (err) => err.status === 401);
    await assert.rejects(verifyTransferToken(env, `${body}.${sig}.x`, 'upload', T0), (err) => err.status === 401);
    await assert.rejects(verifyTransferToken(env, '', 'upload', T0), (err) => err.status === 401);

    // Another key (another deployment, or a rotated secret) does not verify.
    await assert.rejects(verifyTransferToken({ SUPABASE_SERVICE_ROLE_KEY: 'other' }, token, 'upload', T0), (err) => err.status === 401);
    await assert.rejects(verifyTransferToken({ MCP_SIGNING_SECRET: 'x', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, token, 'upload', T0), (err) => err.status === 401);
  });

  it('refuses to sign without a secret, and keeps ids out of path tricks', async () => {
    await assert.rejects(signTransferToken({}, { kind: 'upload', userId: 'u1', uploadId: 'abcdefgh' }, 60), (err) => err.status === 503);
    await assert.rejects(signTransferToken(env, { kind: 'upload', userId: 'u1', uploadId: '../x' }, 60), (err) => err.status === 400);
    await assert.rejects(signTransferToken(env, { kind: 'download', userId: 'u1/..', projectId: 'p' }, 60), (err) => err.status === 400);
    assert.equal(isSafeTransferId('a.b'), false);
    assert.equal(isSafeTransferId('11111111-2222-4333-8444-555555555555'), true);
    assert.equal(stagingKey('u1', 'abcdefgh'), '_mcp-staging/u1/abcdefgh');
    assert.throws(() => stagingKey('u1', '../../u2/x'));
    assert.throws(() => stagingKey('', 'abcdefgh'));
  });
});
