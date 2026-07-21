/**
 * Vision / chat adapters for SP-Bench model evaluation.
 */

function stripDataUrl(url) {
  const s = String(url || '');
  if (s.startsWith('data:')) {
    const idx = s.indexOf(',');
    return idx >= 0 ? s.slice(idx + 1) : s;
  }
  return null;
}

async function fetchImageAsBase64(url) {
  const data = stripDataUrl(url);
  if (data) return { base64: data, mime: 'image/jpeg' };
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = await res.arrayBuffer();
  const mime = res.headers.get('content-type') || 'image/jpeg';
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mime };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Empty model response');
  try {
    return JSON.parse(raw);
  } catch {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return JSON.parse(fence[1].trim());
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('Model did not return valid JSON');
  }
}

async function callOpenAICompatible({
  baseUrl,
  apiKey,
  modelId,
  prompt,
  imageUrls,
  extraHeaders = {},
}) {
  const content = [{ type: 'text', text: prompt }];
  for (const url of imageUrls) {
    content.push({ type: 'image_url', image_url: { url } });
  }
  const endpoint = `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`;
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a careful urban perception rater. Reply with JSON only.' },
        { role: 'user', content },
      ],
    }),
  });
  const latencyMs = Date.now() - started;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `Provider HTTP ${res.status}`);
  }
  const text = data?.choices?.[0]?.message?.content || '';
  return {
    prediction: extractJson(text),
    latencyMs,
    inputTokens: data?.usage?.prompt_tokens ?? null,
    outputTokens: data?.usage?.completion_tokens ?? null,
    rawText: text,
  };
}

async function callAnthropic({ apiKey, modelId, prompt, imageUrls }) {
  const content = [];
  for (const url of imageUrls) {
    const img = await fetchImageAsBase64(url);
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.base64 },
    });
  }
  content.push({ type: 'text', text: prompt });
  const started = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content }],
    }),
  });
  const latencyMs = Date.now() - started;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);
  }
  const text = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return {
    prediction: extractJson(text),
    latencyMs,
    inputTokens: data?.usage?.input_tokens ?? null,
    outputTokens: data?.usage?.output_tokens ?? null,
    rawText: text,
  };
}

async function callGoogle({ apiKey, modelId, prompt, imageUrls, baseUrl }) {
  const parts = [{ text: prompt }];
  for (const url of imageUrls) {
    const img = await fetchImageAsBase64(url);
    parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
  }
  const root = String(baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const endpoint = `${root}/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  const latencyMs = Date.now() - started;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Google HTTP ${res.status}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n') || '';
  return {
    prediction: extractJson(text),
    latencyMs,
    inputTokens: data?.usageMetadata?.promptTokenCount ?? null,
    outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
    rawText: text,
  };
}

export async function evaluateItemWithProvider({
  provider,
  apiKey,
  modelId,
  prompt,
  imageUrls,
}) {
  const urls = (imageUrls || []).filter(Boolean);
  if (!urls.length) throw new Error('No image URL for item');
  const adapter = provider.adapter || 'openai_compatible';
  if (adapter === 'anthropic') {
    return callAnthropic({ apiKey, modelId, prompt, imageUrls: urls });
  }
  if (adapter === 'google') {
    return callGoogle({
      apiKey,
      modelId,
      prompt,
      imageUrls: urls,
      baseUrl: provider.base_url,
    });
  }
  const extraHeaders = provider.id === 'openrouter'
    ? {
      'HTTP-Referer': 'https://sp-survey.org',
      'X-Title': 'SP-Bench',
    }
    : {};
  return callOpenAICompatible({
    baseUrl: provider.base_url || 'https://api.openai.com/v1',
    apiKey,
    modelId,
    prompt,
    imageUrls: urls,
    extraHeaders,
  });
}

export async function validateProviderKey(provider, apiKey) {
  const adapter = provider.adapter || 'openai_compatible';
  if (adapter === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error(`Anthropic key validation failed (${res.status})`);
    const data = await res.json().catch(() => ({}));
    return { ok: true, models: (data?.data || []).map((m) => m.id).filter(Boolean) };
  }
  if (adapter === 'google') {
    const root = String(provider.base_url || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const res = await fetch(`${root}/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`Google key validation failed (${res.status})`);
    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      models: (data?.models || [])
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean),
    };
  }
  const base = String(provider.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Key validation failed (${res.status})`);
  const data = await res.json().catch(() => ({}));
  return { ok: true, models: (data?.data || []).map((m) => m.id).filter(Boolean) };
}
