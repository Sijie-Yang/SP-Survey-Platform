import {
  PREVIEW_SESSION_MESSAGE,
  isPreviewWorkerHost,
  isTrustedPreviewSessionOrigin,
  parsePreviewSessionMessage,
} from './previewSession';

describe('preview session handshake', () => {
  test('only accepts workers.dev hosts', () => {
    expect(isPreviewWorkerHost('0ac67fe1-sp-survey.sijieyangyang.workers.dev')).toBe(true);
    expect(isPreviewWorkerHost('sp-survey.org')).toBe(false);
    expect(isPreviewWorkerHost('localhost')).toBe(false);
  });

  test('only trusts localhost senders', () => {
    expect(isTrustedPreviewSessionOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isTrustedPreviewSessionOrigin('http://localhost:3000')).toBe(true);
    expect(isTrustedPreviewSessionOrigin('https://sp-survey.org')).toBe(false);
    expect(isTrustedPreviewSessionOrigin('https://evil.example')).toBe(false);
  });

  test('rejects incomplete or cross-origin payloads', () => {
    expect(parsePreviewSessionMessage({
      origin: 'http://127.0.0.1:3000',
      data: { type: PREVIEW_SESSION_MESSAGE, access_token: 'a', refresh_token: 'b' },
    }, 'preview.workers.dev')).toEqual({
      access_token: 'a',
      refresh_token: 'b',
    });
    expect(parsePreviewSessionMessage({
      origin: 'https://sp-survey.org',
      data: { type: PREVIEW_SESSION_MESSAGE, access_token: 'a', refresh_token: 'b' },
    }, 'preview.workers.dev')).toBeNull();
    expect(parsePreviewSessionMessage({
      origin: 'http://127.0.0.1:3000',
      data: { type: PREVIEW_SESSION_MESSAGE, access_token: 'a' },
    }, 'preview.workers.dev')).toBeNull();
    expect(parsePreviewSessionMessage({
      origin: 'http://127.0.0.1:3000',
      data: { type: PREVIEW_SESSION_MESSAGE, access_token: 'a', refresh_token: 'b' },
    }, 'sp-survey.org')).toBeNull();
  });
});
