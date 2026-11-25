import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authorizationServerMetadata } from './mcpOAuth.mjs';

describe('MCP OAuth metadata', () => {
  it('sends clients to dynamic registration, not client ID metadata documents', () => {
    const meta = authorizationServerMetadata(new URL('https://sp-survey.org/.well-known/oauth-authorization-server'), { APP_URL: 'https://sp-survey.org' });
    assert.equal(meta.registration_endpoint, 'https://sp-survey.org/oauth/register');
    assert.equal(meta.client_id_metadata_document_supported, false);
  });
});
