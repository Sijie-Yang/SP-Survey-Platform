/**
 * Deterministic media assignment for silicon runs (seeded, no Math.random).
 * Follows the participant folder / fixed-selection rules instead of shuffling the whole pool.
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

function imageUrl(img) {
  return img?.url || img?.path || (typeof img === 'string' ? img : '');
}

function imageFolder(img) {
  return img?.folder || img?.folderPath || img?.mediaFolder || img?.logicalFolder || '';
}

export function filterPoolForQuestion(pool = [], question = {}, dataset = {}) {
  const items = Array.isArray(pool) ? pool : [];
  const selected = question.selectedImageUrls || question.imageLinks || question.mediaUrls;
  if (question.imageSelectionMode === 'huggingface_manual' || (Array.isArray(selected) && selected.length)) {
    const allowed = new Set((selected || []).map(String));
    return items.filter((img) => allowed.has(imageUrl(img)));
  }
  const folder = question.mediaFolder || question.allowedFolder || question.folder;
  if (folder) {
    return items.filter((img) => imageFolder(img) === folder);
  }
  const tags = dataset.mediaFolderTags || dataset.folderTags || {};
  const category = question.mediaCategory || question.category;
  if (category) {
    return items.filter((img) => {
      const tag = tags[imageFolder(img)];
      const value = tag && typeof tag === 'object' ? tag.category || tag.set : tag;
      return value === category;
    });
  }
  return items;
}

export function pickMediaForSilicon({
  pool = [],
  question,
  seed,
  count,
  dataset = {},
}) {
  const n = Math.max(1, Number(count || question?.imageCount || question?.mediaCount || 4));
  const filtered = filterPoolForQuestion(pool, question, dataset);
  const urls = filtered.map(imageUrl).filter(Boolean);
  if (!urls.length) return [];
  if (question?.imageSelectionMode === 'huggingface_manual' || question?.selectedImageUrls?.length) {
    return urls.slice(0, Math.min(n, urls.length));
  }
  return seededShuffle(urls, `${seed}:${question?.name || 'q'}`).slice(0, Math.min(n, urls.length));
}

export function assignMediaForSurvey({ surveyConfig, pool, seed, questionNames, dataset }) {
  const displayed = {};
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (questionNames && !questionNames.includes(el.name)) continue;
      const needs = /image|media|skillquestion/.test(el.type || '');
      if (!needs) continue;
      displayed[el.name] = pickMediaForSilicon({ pool, question: el, seed, dataset });
    }
  }
  return displayed;
}
