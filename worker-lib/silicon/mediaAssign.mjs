/**
 * Deterministic media assignment for silicon runs (seeded, no Math.random).
 */

function hash32(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededShuffle(items, seed) {
  const arr = [...(items || [])];
  let s = hash32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pickMediaForSilicon({
  pool = [],
  question,
  seed,
  count,
}) {
  const n = Math.max(1, Number(count || question?.imageCount || question?.mediaCount || 4));
  const urls = (pool || [])
    .map((img) => img.url || img.path)
    .filter(Boolean);
  if (!urls.length) return [];
  return seededShuffle(urls, `${seed}:${question?.name || 'q'}`).slice(0, Math.min(n, urls.length));
}

export function assignMediaForSurvey({ surveyConfig, pool, seed, questionNames }) {
  const displayed = {};
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (questionNames && !questionNames.includes(el.name)) continue;
      const needs = /image|media|skillquestion/.test(el.type || '');
      if (!needs) continue;
      displayed[el.name] = pickMediaForSilicon({ pool, question: el, seed });
    }
  }
  return displayed;
}
