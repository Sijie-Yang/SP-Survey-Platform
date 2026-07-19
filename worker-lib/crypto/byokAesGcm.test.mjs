/**
 * Node test for AES-GCM helpers (run with: node --test worker-lib/crypto/byokAesGcm.test.mjs)
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  decryptApiKey,
  detectProvider,
  encryptApiKey,
  keyHint,
} from './byokAesGcm.mjs';

const env = {
  BYOK_ENCRYPTION_KEY: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  BYOK_ENCRYPTION_KEY_ID: '1',
};

test('encrypt/decrypt round-trip', async () => {
  const plain = 'sk-test-openai-key-1234567890';
  const enc = await encryptApiKey(env, plain);
  assert.equal(enc.provider, 'openai');
  assert.equal(enc.hint, keyHint(plain));
  const decoded = await decryptApiKey(env, enc.ciphertext, enc.nonce);
  assert.equal(decoded, plain);
});

test('detects openrouter keys', () => {
  assert.equal(detectProvider('sk-or-v1-abc'), 'openrouter');
  assert.equal(detectProvider('sk-abc'), 'openai');
});
