const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
]);

export function assertSafeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    throw Object.assign(new Error('A custom provider needs a base URL.'), {
      status: 400,
      code: 'BASE_URL_REQUIRED',
    });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error('Base URL is not a valid URL.'), {
      status: 400,
      code: 'BASE_URL_INVALID',
    });
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Custom endpoints must use HTTPS.'), {
      status: 400,
      code: 'BASE_URL_INSECURE',
    });
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host)
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || /^(0|127|169\.254)\./.test(host)
    || /^(fc|fd|fe8|fe9|fea|feb)[0-9a-f:]*$/i.test(host)) {
    throw Object.assign(new Error('This host is not allowed for model requests.'), {
      status: 400,
      code: 'BASE_URL_BLOCKED',
    });
  }
  if (/^(10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) {
    throw Object.assign(new Error('Private network endpoints are blocked.'), {
      status: 400,
      code: 'BASE_URL_PRIVATE',
    });
  }
  return parsed.toString().replace(/\/$/, '');
}

export function normalizeEndpoint(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}
