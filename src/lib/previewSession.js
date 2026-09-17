export const PREVIEW_SESSION_MESSAGE = 'sp-survey-preview-session';

export function isPreviewWorkerHost(hostname = '') {
  return /\.workers\.dev$/i.test(String(hostname || ''));
}

export function isTrustedPreviewSessionOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function parsePreviewSessionMessage(event, hostname) {
  if (!isPreviewWorkerHost(hostname)) return null;
  if (!isTrustedPreviewSessionOrigin(event?.origin)) return null;
  const data = event?.data;
  if (!data || data.type !== PREVIEW_SESSION_MESSAGE) return null;
  const accessToken = String(data.access_token || '').trim();
  const refreshToken = String(data.refresh_token || '').trim();
  if (!accessToken || !refreshToken) return null;
  return { access_token: accessToken, refresh_token: refreshToken };
}
