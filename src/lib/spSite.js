/**
 * SP-Site: run a whole survey interface designed by an external LLM.
 *
 * The site is one HTML page rendered full-screen in a sandboxed iframe. The
 * platform keeps owning what matters for the data: it draws the media, tells
 * the site exactly what to show (questions + media + allowed answer values),
 * validates every answer against the native question contract and records it
 * through the normal SurveyJS model, so responses, analysis and export are the
 * same as for a standard survey. Pure module; the React host is SpSiteFrame.
 */

import { applyMediaToElement } from './surveyMediaInjection';
import { sliderScale } from './sliderScale';
import { isTrialsAnswer, mediaSetToShownIds, mediaSetToShownImages } from './trialNavigation';

export const SP_SITE_VERSION = '1.0';
export const SP_SITE_MAX_BYTES = 3 * 1024 * 1024;

const DISPLAY_TYPES = new Set(['html', 'expression', 'image', 'mediadisplay']);
const STRUCTURAL_TYPES = new Set(['panel', 'paneldynamic']);
const RATING_TYPES = new Set(['rating', 'imagerating', 'mediarating']);
const BOOLEAN_TYPES = new Set(['boolean', 'imageboolean', 'mediaboolean', 'consent']);
const SINGLE_CHOICE_TYPES = new Set(['radiogroup', 'dropdown', 'imagepicker', 'mediapicker']);
const MULTI_CHOICE_TYPES = new Set(['checkbox', 'imagecheckbox', 'mediacheckbox', 'tagbox']);
const RANKING_TYPES = new Set(['ranking', 'imageranking', 'mediaranking']);
const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);
const MATRIX_TYPES = new Set(['matrix', 'imagematrix', 'mediamatrix']);
const ALLOCATION_TYPES = new Set(['pointallocation', 'imagepointallocation', 'mediapointallocation']);
// Choices of these types are the drawn media themselves (value image_N / media_N).
const MEDIA_CHOICE_TYPES = new Set(['imagepicker', 'imageranking', 'mediaranking', 'mediapicker']);

/** Answer family the site must record for a question type. */
export function answerKindOf(element = {}) {
  const type = element.type;
  if (DISPLAY_TYPES.has(type)) return 'display';
  if (type === 'number' || (type === 'text' && element.inputType === 'number')) return 'number';
  if (type === 'text' || type === 'comment') return 'text';
  if (RATING_TYPES.has(type)) return 'rating';
  if (BOOLEAN_TYPES.has(type)) return 'boolean';
  if (SINGLE_CHOICE_TYPES.has(type)) return element.multiSelect ? 'multiChoice' : 'choice';
  if (MULTI_CHOICE_TYPES.has(type)) return 'multiChoice';
  if (RANKING_TYPES.has(type)) return 'ranking';
  if (SLIDER_TYPES.has(type)) return 'sliders';
  if (MATRIX_TYPES.has(type)) return 'matrix';
  if (ALLOCATION_TYPES.has(type)) return 'allocation';
  if (type === 'imageannotation') return 'annotation';
  return 'unsupported';
}

export const ANSWER_SHAPES = {
  text: 'a string',
  number: 'a number within min/max',
  rating: 'a number from rateMin to rateMax (or one of rateValues)',
  boolean: 'true or false',
  choice: 'one choices[].value (string)',
  multiChoice: 'an array of choices[].value',
  ranking: 'an array of every choices[].value, best first',
  sliders: 'an object { <dimension id>: number }',
  matrix: 'an object { <row value>: <column value> } for every row',
  allocation: 'an object { <choice value>: points } summing to budget',
  annotation: 'an object { shapes: [{ tool, label, points: [{ x, y }] }] } with x/y normalised 0–1',
};

function localText(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const hit = (lang && value[lang]) ?? value.default ?? Object.values(value).find((v) => typeof v === 'string');
    return hit == null ? '' : String(hit);
  }
  return '';
}

function itemList(items, lang) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item == null) return null;
    if (typeof item !== 'object') return { value: String(item), text: String(item) };
    const value = String(item.value ?? item.id ?? item.text ?? '');
    if (!value) return null;
    const out = { value, text: localText(item.text ?? item.label, lang) || value };
    if (item.imageLink) out.imageUrl = item.imageLink;
    return out;
  }).filter(Boolean);
}

function mediaItem(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { url: entry, name: entry.split('?')[0].split('/').pop(), type: 'image' };
  const url = entry.url || entry.imageLink || entry.src;
  if (!url) return null;
  return { url, name: entry.name || entry.imageName || String(url).split('?')[0].split('/').pop(), type: entry.type || 'image' };
}

/** Media the platform drew for a (non-trial) question, in display order. */
export function elementMedia(element = {}) {
  if (Array.isArray(element.mediaItems) && element.mediaItems.length) return element.mediaItems.map(mediaItem).filter(Boolean);
  const urls = element.imageUrls?.length ? element.imageUrls : element.imageLinks;
  if (Array.isArray(urls) && urls.length) {
    return urls.map((url, i) => mediaItem({ url, name: element.imageNames?.[i] })).filter(Boolean);
  }
  if (element.annotationImageUrl) return [mediaItem({ url: element.annotationImageUrl })];
  if (element.imageLink) return [mediaItem({ url: element.imageLink, name: element.imageName })];
  if (MEDIA_CHOICE_TYPES.has(element.type) || ['imagerating', 'imageboolean', 'imagematrix'].includes(element.type)) {
    return (element.choices || []).map((c) => mediaItem(c && { url: c.imageLink, name: c.imageName })).filter(Boolean);
  }
  return [];
}

function answerChoices(element, lang) {
  const kind = answerKindOf(element);
  if (!['choice', 'multiChoice', 'ranking', 'allocation'].includes(kind)) return undefined;
  const choices = itemList(element.choices, lang);
  if (element.allowTie && element.tieLabel) {
    choices.push({ value: String(element.tieLabel), text: String(element.tieLabel), tie: true });
  }
  return choices;
}

function trialChoices(element, mediaSet, lang) {
  if (!MEDIA_CHOICE_TYPES.has(element.type)) return answerChoices(element, lang);
  const scratch = { type: element.type, name: element.name };
  applyMediaToElement(scratch, mediaSet || []);
  return answerChoices({ ...element, choices: scratch.choices || [] }, lang);
}

function trialCountOf(element) {
  const n = Number(element?.trialCount || 1);
  return Number.isFinite(n) && n > 1 ? Math.min(200, Math.floor(n)) : 1;
}

function flatElements(pages) {
  const out = [];
  const walk = (elements, pageName) => (elements || []).forEach((element) => {
    if (!element || typeof element !== 'object') return;
    if (STRUCTURAL_TYPES.has(element.type)) {
      walk(element.elements || element.templateElements, pageName);
      return;
    }
    out.push({ element, pageName });
  });
  (pages || []).forEach((page) => walk(page?.elements, page?.name));
  return out;
}

/**
 * What the site receives at start-up: every question with its wording, the
 * media drawn for this participant and the exact answer values allowed.
 * @param {object} surveyJson survey config after media injection
 */
export function buildSiteQuestions(surveyJson, { language } = {}) {
  const lang = language || surveyJson?.locale || null;
  return flatElements(surveyJson?.pages)
    // Empty pages get an invisible html placeholder at runtime; it is not content.
    .filter(({ element }) => element.name && !(element.type === 'html' && /_placeholder$/.test(element.name)))
    .map(({ element, pageName }) => {
    const kind = answerKindOf(element);
    const trialCount = trialCountOf(element);
    const q = {
      name: element.name,
      page: pageName || null,
      type: element.type === 'text' && element.inputType === 'number' ? 'number' : element.type,
      kind,
      answerShape: ANSWER_SHAPES[kind] || null,
      title: localText(element.title, lang) || element.name,
      description: localText(element.description, lang),
      required: Boolean(element.isRequired),
      trialCount,
    };
    if (kind === 'display' && element.type === 'html') q.html = localText(element.html, lang);
    if (kind === 'number') { q.min = element.min ?? null; q.max = element.max ?? null; }
    if (kind === 'text' && element.maxLength) q.maxLength = Number(element.maxLength);
    if (kind === 'rating') {
      q.rateMin = Number(element.rateMin ?? 1);
      q.rateMax = Number(element.rateMax ?? element.rateCount ?? 5);
      if (Array.isArray(element.rateValues) && element.rateValues.length) q.rateValues = itemList(element.rateValues, lang);
      if (element.minRateDescription) q.minLabel = localText(element.minRateDescription, lang);
      if (element.maxRateDescription) q.maxLabel = localText(element.maxRateDescription, lang);
    }
    if (kind === 'boolean') {
      if (element.labelTrue) q.labelTrue = localText(element.labelTrue, lang);
      if (element.labelFalse) q.labelFalse = localText(element.labelFalse, lang);
    }
    if (kind === 'sliders') {
      q.dimensions = (element.dimensions || []).filter((d) => d?.id).map((d) => {
        const scale = sliderScale(d, element);
        return {
          id: String(d.id),
          label: localText(d.label ?? d.text, lang),
          left: localText(d.left ?? d.minLabel, lang),
          right: localText(d.right ?? d.maxLabel, lang),
          min: scale.min,
          max: scale.max,
          step: scale.step,
        };
      });
    }
    if (kind === 'matrix') {
      q.rows = itemList(element.rows, lang);
      q.columns = itemList(element.columns, lang);
    }
    if (kind === 'allocation') q.budget = Number(element.budget ?? 100);
    if (kind === 'annotation') {
      q.tools = (element.allowedTools?.length ? element.allowedTools : ['point', 'line', 'polygon', 'bbox']).map(String);
      q.labels = itemList(element.annotationLabels, lang).map((l) => l.text);
      q.minShapes = Number(element.minAnnotations ?? 0);
      q.maxShapes = Number(element.maxAnnotations ?? 50);
    }
    if (trialCount > 1 && Array.isArray(element.trialMediaSets) && element.trialMediaSets.length) {
      q.trials = element.trialMediaSets.slice(0, trialCount).map((set) => ({
        media: (set || []).map(mediaItem).filter(Boolean),
        choices: trialChoices(element, set, lang),
      }));
    } else {
      q.media = elementMedia(element);
      const choices = answerChoices(element, lang);
      if (choices) q.choices = choices;
    }
    if (trialCount > 1 && !q.trials) {
      q.trials = Array.from({ length: trialCount }, () => ({ media: q.media || [], choices: q.choices }));
    }
    return q;
  });
}

function fail(reason) { return { ok: false, reason }; }

/** UTF-8 byte length (TextEncoder is not available everywhere this runs). */
export function utf8Bytes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; } else n += 3;
  }
  return n;
}

function asValue(item) {
  return String(typeof item === 'object' && item ? item.value ?? item.text : item);
}

/** Check one answer (one trial for repeated questions) against its question. */
export function validateSiteAnswer(question, value, choices = question?.choices) {
  const kind = question?.kind;
  const allowed = (choices || []).map((c) => c.value);
  switch (kind) {
    case 'text': {
      const text = typeof value === 'string' ? value : (value == null ? '' : String(value));
      if (question.maxLength && text.length > question.maxLength) return fail(`Text longer than ${question.maxLength} characters`);
      return { ok: true, value: text };
    }
    case 'number': {
      const n = Number(value);
      if (value === '' || value === true || value === false || !Number.isFinite(n)) return fail('Expected a number');
      if (question.min != null && n < Number(question.min)) return fail(`Expected a number ≥ ${question.min}`);
      if (question.max != null && n > Number(question.max)) return fail(`Expected a number ≤ ${question.max}`);
      return { ok: true, value: n };
    }
    case 'rating': {
      if (question.rateValues?.length) {
        const hit = question.rateValues.find((r) => r.value === asValue(value));
        if (!hit) return fail(`Expected one of ${question.rateValues.map((r) => r.value).join(', ')}`);
        const n = Number(hit.value);
        return { ok: true, value: Number.isFinite(n) ? n : hit.value };
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n < question.rateMin || n > question.rateMax) {
        return fail(`Expected a number from ${question.rateMin} to ${question.rateMax}`);
      }
      return { ok: true, value: n };
    }
    case 'boolean':
      if (typeof value !== 'boolean') return fail('Expected true or false');
      return { ok: true, value };
    case 'choice': {
      const v = asValue(value);
      if (!allowed.includes(v)) return fail(`Expected one of ${allowed.join(', ')}`);
      return { ok: true, value: v };
    }
    case 'multiChoice': {
      if (!Array.isArray(value)) return fail('Expected an array of choice values');
      const list = value.map(asValue);
      if (list.some((v) => !allowed.includes(v))) return fail(`Every item must be one of ${allowed.join(', ')}`);
      if (new Set(list).size !== list.length) return fail('Choice values must be unique');
      return { ok: true, value: list };
    }
    case 'ranking': {
      if (!Array.isArray(value)) return fail('Expected an array of choice values, best first');
      const list = value.map(asValue);
      const ranked = allowed.filter((v) => !(choices || []).find((c) => c.value === v)?.tie);
      if (new Set(list).size !== list.length) return fail('Ranking items must be unique');
      if (list.some((v) => !ranked.includes(v))) return fail(`Every item must be one of ${ranked.join(', ')}`);
      if (list.length !== ranked.length) return fail(`Rank all ${ranked.length} items`);
      return { ok: true, value: list };
    }
    case 'sliders': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected an object { dimensionId: number }');
      const out = {};
      for (const d of question.dimensions || []) {
        if (value[d.id] == null) continue;
        const n = Number(value[d.id]);
        if (!Number.isFinite(n) || n < d.min || n > d.max) return fail(`${d.id} must be a number from ${d.min} to ${d.max}`);
        out[d.id] = n;
      }
      const unknown = Object.keys(value).filter((k) => !(question.dimensions || []).some((d) => d.id === k));
      if (unknown.length) return fail(`Unknown dimension ${unknown.join(', ')}`);
      if (!Object.keys(out).length) return fail('Answer at least one dimension');
      return { ok: true, value: out };
    }
    case 'matrix': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected an object { row: column }');
      const rows = (question.rows || []).map((r) => r.value);
      const cols = (question.columns || []).map((c) => c.value);
      const out = {};
      for (const [row, raw] of Object.entries(value)) {
        if (!rows.includes(row)) return fail(`Unknown row ${row}`);
        const col = asValue(raw);
        if (!cols.includes(col)) return fail(`Row ${row} must be one of ${cols.join(', ')}`);
        out[row] = col;
      }
      return { ok: true, value: out };
    }
    case 'allocation': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected an object { choice: points }');
      const out = {};
      let sum = 0;
      for (const key of allowed) {
        const n = Number(value[key] ?? 0);
        if (!Number.isFinite(n) || n < 0) return fail(`${key} must be a number ≥ 0`);
        out[key] = n;
        sum += n;
      }
      const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
      if (unknown.length) return fail(`Unknown choice ${unknown.join(', ')}`);
      if (Math.abs(sum - question.budget) > 0.01) return fail(`Points must sum to ${question.budget}`);
      return { ok: true, value: out };
    }
    case 'annotation': {
      const shapes = Array.isArray(value) ? value : value?.shapes;
      if (!Array.isArray(shapes)) return fail('Expected { shapes: [...] }');
      if (shapes.length > question.maxShapes) return fail(`At most ${question.maxShapes} shapes`);
      const out = [];
      for (const shape of shapes) {
        const tool = String(shape?.tool || '').toLowerCase();
        if (!question.tools.includes(tool)) return fail(`Tool ${tool || '(missing)'} is not allowed; use ${question.tools.join(', ')}`);
        const label = shape?.label == null ? '' : String(shape.label);
        if (question.labels.length && label && !question.labels.includes(label)) return fail(`Label ${label} is not allowed`);
        const need = tool === 'point' ? 1 : (tool === 'polygon' ? 3 : 2);
        const points = (Array.isArray(shape?.points) ? shape.points : []).map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
        if (points.length < need) return fail(`${tool} needs at least ${need} points`);
        if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) {
          return fail('Points must be normalised to 0–1');
        }
        out.push({ tool, label, points });
      }
      return { ok: true, value: { shapes: out } };
    }
    case 'display':
      return fail('This item shows content and takes no answer');
    default:
      return fail(`Question type ${question?.type} cannot be answered from a site`);
  }
}

function emptyTrials(n) {
  return { trials: Array.from({ length: n }, () => ({ value: null, shown_images: [], shown_media_ids: [] })) };
}

/**
 * Validate an answer from the site and merge it into the stored value.
 * `value === null` clears the answer (or the trial).
 * @returns {{ ok: true, stored: any } | { ok: false, reason: string }}
 */
export function applySiteAnswer(question, previous, value, { trial } = {}) {
  if (!question) return fail('Unknown question');
  if (question.trialCount > 1) {
    const index = Number(trial);
    if (!Number.isInteger(index) || index < 0 || index >= question.trialCount) {
      return fail(`${question.name} repeats ${question.trialCount} times: pass { trial: 0…${question.trialCount - 1} }`);
    }
    const slot = question.trials?.[index] || {};
    const next = isTrialsAnswer(previous) && previous.trials.length === question.trialCount
      ? { trials: previous.trials.map((t) => ({ ...t })) }
      : emptyTrials(question.trialCount);
    if (value == null) {
      next.trials[index] = { value: null, shown_images: [], shown_media_ids: [] };
      return { ok: true, stored: next };
    }
    const checked = validateSiteAnswer(question, value, slot.choices);
    if (!checked.ok) return fail(`${question.name} trial ${index}: ${checked.reason}`);
    next.trials[index] = {
      value: checked.value,
      shown_images: mediaSetToShownImages(slot.media || []),
      shown_media_ids: mediaSetToShownIds(slot.media || []),
    };
    return { ok: true, stored: next };
  }
  if (value == null) return { ok: true, stored: null };
  const checked = validateSiteAnswer(question, value);
  if (!checked.ok) return fail(`${question.name}: ${checked.reason}`);
  return { ok: true, stored: checked.value };
}

function answered(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Required questions (or required trials) that still have no answer. */
export function missingRequired(questions, answers = {}) {
  return (questions || []).filter((q) => q.required && q.kind !== 'display').filter((q) => {
    const value = answers[q.name];
    if (q.trialCount > 1) {
      return !isTrialsAnswer(value) || value.trials.length < q.trialCount || value.trials.some((t) => !answered(t?.value));
    }
    if (q.kind === 'boolean') return typeof value !== 'boolean';
    return !answered(value);
  }).map((q) => q.name);
}

const CDN_HOSTS = [
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://unpkg.com',
  'https://cdn.tailwindcss.com',
  'https://esm.sh',
];

export const SP_SITE_SCRIPT_HOSTS = CDN_HOSTS;

/** Runs first inside the site: defines window.SPSite and talks to the platform. */
export const SP_SITE_SDK_SOURCE = `
(function () {
  var boot = window.__SP_SITE_BOOT__ || null;
  var questions = [], survey = {}, answers = {}, ready = false, waiters = [], pending = {}, seq = 0;
  var allowedHosts = (boot && boot.allowedHosts) || [];
  var submitHandlers = [], submitQueue = [];
  function post(msg) { window.parent.postMessage(Object.assign({ source: 'sp-site' }, msg), '*'); }
  function call(type, payload) {
    return new Promise(function (resolve) {
      seq += 1;
      pending[seq] = resolve;
      post(Object.assign({ type: type, requestId: seq }, payload));
    });
  }
  // The sandbox has no origin, so storage throws; give the site an in-memory stand-in.
  ['localStorage', 'sessionStorage'].forEach(function (key) {
    try { window[key].getItem('x'); } catch (err) {
      var data = {};
      var store = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; },
        clear: function () { data = {}; },
        key: function (i) { return Object.keys(data)[i] || null; }
      };
      Object.defineProperty(store, 'length', { get: function () { return Object.keys(data).length; } });
      try { Object.defineProperty(window, key, { value: store, configurable: true }); } catch (e2) { /* keep native */ }
    }
  });

  // Requests to hosts the researcher did not allow never leave the page. Submissions
  // (fetch/XHR/beacon/form posts) are handed to SPSite.onSubmit handlers instead, so a
  // converted survey can map its old "send results" payload onto SPSite.answer.
  // An imported page keeps a <base href> to its original site; otherwise relative
  // URLs belong to the page itself, which has no server here.
  function pageBase() { return /^https?:/.test(document.baseURI) ? document.baseURI : 'https://invalid.local/'; }
  function hostAllowed(url) {
    try { return allowedHosts.indexOf(new URL(url, pageBase()).host) >= 0; } catch (e) { return false; }
  }
  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch (e) { /* not JSON */ }
      if (/^[^=&\\s]+=[^&]*(&[^=&\\s]+=[^&]*)*$/.test(body)) {
        var out = {}; new URLSearchParams(body).forEach(function (v, k) { out[k] = v; }); return out;
      }
      return body;
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var fd = {}; body.forEach(function (v, k) { fd[k] = typeof v === 'string' ? v : '[file]'; }); return fd;
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      var sp = {}; body.forEach(function (v, k) { sp[k] = v; }); return sp;
    }
    return body;
  }
  function dispatch(item) {
    if (!submitHandlers.length) { submitQueue.push(item); console.warn('[SPSite] captured a ' + item.method + ' to ' + item.url + '; register SPSite.onSubmit to record it'); return; }
    submitHandlers.forEach(function (fn) { try { fn(item); } catch (err) { console.error(err); } });
  }
  function capture(kind, url, method, body) {
    dispatch({ kind: kind, url: String(url || ''), method: String(method || 'POST').toUpperCase(), data: parseBody(body) });
  }
  // SPSite.onRequest handlers can answer the page's own requests (a converted page
  // that loaded its questions from, or saved answers to, its own server). Requests
  // made before the adapter script has run wait for it (DOMContentLoaded).
  var requestHandlers = [];
  var adaptersReady = new Promise(function (resolve) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(resolve, 0); });
    else resolve();
  });
  // Same-page paths stay relative ("/api/state?x=1"); other hosts keep their full URL.
  function absolute(url) {
    try {
      var base = new URL(pageBase()), u = new URL(url, base);
      return u.host === base.host ? u.pathname + u.search : u.href;
    } catch (e) { return String(url || ''); }
  }
  function answerRequest(req) {
    return adaptersReady.then(function () {
      for (var i = 0; i < requestHandlers.length; i += 1) {
        var out;
        try { out = requestHandlers[i](req); } catch (err) { console.error('[SPSite] onRequest handler failed', err); return Promise.resolve({ status: 500, json: { error: String(err && err.message || err) } }); }
        if (out !== undefined) return Promise.resolve(out).then(function (r) { return r === undefined || r === null ? { status: 200, json: { ok: true } } : r; });
      }
      return undefined;
    });
  }
  function responseParts(r) {
    var isRaw = r && typeof r === 'object' && ('status' in r || 'json' in r || 'body' in r);
    var status = isRaw && r.status ? r.status : 200;
    var body = isRaw ? ('json' in r ? JSON.stringify(r.json) : (r.body == null ? '' : String(r.body))) : JSON.stringify(r);
    var type = isRaw && !('json' in r) && r.contentType ? r.contentType : 'application/json';
    return { status: status, body: body, type: type };
  }
  function headersOf(init) {
    var out = {};
    var h = init && init.headers;
    if (!h) return out;
    if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach(function (v, k) { out[k] = v; });
    else Object.keys(h).forEach(function (k) { out[k] = h[k]; });
    return out;
  }
  var nativeFetch = window.fetch && window.fetch.bind(window);
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (hostAllowed(url)) return nativeFetch(input, init);
      var req = { kind: 'fetch', url: absolute(url), method: method, data: parseBody(init && init.body), headers: headersOf(init) };
      return answerRequest(req).then(function (r) {
        if (r !== undefined) { var p = responseParts(r); return new Response(p.body, { status: p.status, headers: { 'Content-Type': p.type } }); }
        if (/^(GET|HEAD)$/.test(method)) throw new TypeError('SP-Survey blocked a request to ' + url);
        dispatch(req);
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    };
  }
  if (window.XMLHttpRequest) {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this.__sp = { method: String(method || 'GET').toUpperCase(), url: url }; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
      var info = this.__sp || {};
      if (hostAllowed(info.url)) return send.apply(this, arguments);
      var xhr = this;
      var req = { kind: 'xhr', url: absolute(info.url), method: info.method || 'GET', data: parseBody(body), headers: {} };
      function finish(status, text) {
        ['readyState', 'status', 'responseText', 'response'].forEach(function (k) {
          Object.defineProperty(xhr, k, { configurable: true, value: { readyState: 4, status: status, responseText: text, response: text }[k] });
        });
        ['readystatechange', 'load', 'loadend'].forEach(function (type) {
          var ev = new Event(type); xhr.dispatchEvent(ev);
          if (typeof xhr['on' + type] === 'function') xhr['on' + type](ev);
        });
      }
      answerRequest(req).then(function (r) {
        if (r !== undefined) { var p = responseParts(r); finish(p.status, p.body); return; }
        if (/^(GET|HEAD)$/.test(req.method)) { var ev = new Event('error'); xhr.dispatchEvent(ev); if (typeof xhr.onerror === 'function') xhr.onerror(ev); return; }
        dispatch(req);
        finish(200, '{"ok":true}');
      });
    };
  }
  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url, data) { if (!hostAllowed(url)) capture('beacon', url, 'POST', data); return true; };
  }
  function formData(form) { var out = {}; new FormData(form).forEach(function (v, k) { out[k] = typeof v === 'string' ? v : '[file]'; }); return out; }
  HTMLFormElement.prototype.submit = function () {
    dispatch({ kind: 'form', url: String(this.action || ''), method: String(this.method || 'GET').toUpperCase(), data: formData(this) });
  };
  window.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    var form = e.target;
    dispatch({ kind: 'form', url: String(form.action || ''), method: String(form.method || 'GET').toUpperCase(), data: formData(form) });
  });

  function detail() { return { questions: questions, survey: survey, answers: answers }; }
  function fire() {
    var d = detail();
    waiters.splice(0).forEach(function (cb) { try { cb(d); } catch (err) { console.error(err); } });
    document.dispatchEvent(new CustomEvent('spsite-ready', { detail: d }));
  }
  function whenDom(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  if (boot) {
    // Questions and media are known before the page's own scripts run.
    questions = boot.questions || []; survey = boot.survey || {}; answers = boot.answers || {};
    ready = true;
    whenDom(fire);
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || d.source !== 'sp-site-host') return;
    if (d.type === 'init') {
      if (ready) return;
      questions = d.questions || []; survey = d.survey || {}; answers = d.answers || {};
      ready = true;
      whenDom(fire);
    } else if (d.type === 'result' && pending[d.requestId]) {
      var resolve = pending[d.requestId];
      delete pending[d.requestId];
      if (d.result && d.result.ok && d.name) answers[d.name] = d.stored;
      if (d.result && !d.result.ok) console.warn('[SPSite]', d.result.error || d.result.missing);
      resolve(d.result);
    }
  });
  window.SPSite = {
    version: '${SP_SITE_VERSION}',
    platform: true,
    allowedHosts: allowedHosts.slice(),
    onReady: function (cb) { if (ready) cb(detail()); else waiters.push(cb); },
    getQuestions: function () { return questions; },
    getQuestion: function (name) { for (var i = 0; i < questions.length; i += 1) if (questions[i].name === name) return questions[i]; return null; },
    getSurvey: function () { return survey; },
    getAnswers: function () { return answers; },
    answer: function (name, value, options) { return call('answer', { name: name, value: value === undefined ? null : value, trial: options && options.trial }); },
    complete: function () { return call('complete', {}); },
    onRequest: function (fn) { requestHandlers.push(fn); },
    onSubmit: function (fn) {
      submitHandlers.push(fn);
      submitQueue.splice(0).forEach(function (item) { try { fn(item); } catch (err) { console.error(err); } });
    }
  };
  post({ type: 'hello' });
})();
`;

function escapeScript(text) {
  return String(text).replace(/<\/script/gi, '<\\/script');
}

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i;

/** Hostnames a researcher may allow (no schemes, paths or wildcards). */
export function normalizeAllowedHosts(hosts) {
  return [...new Set((Array.isArray(hosts) ? hosts : [])
    .map((h) => String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((h) => HOST_RE.test(h)))].slice(0, 20);
}

/** CSP for one site; allowed hosts may serve scripts, styles, fonts and data. */
export function buildSiteCsp(allowedHosts = []) {
  const extra = normalizeAllowedHosts(allowedHosts).map((h) => `https://${h}`);
  const hosts = [...CDN_HOSTS, ...extra].join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${hosts}`,
    `style-src 'unsafe-inline' https://fonts.googleapis.com ${hosts}`,
    `font-src data: https://fonts.gstatic.com ${hosts}`,
    'img-src https: data: blob:',
    'media-src https: data: blob:',
    extra.length ? `connect-src ${extra.join(' ')}` : "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    'worker-src blob:',
  ].join('; ');
}

/**
 * Insert the CSP, the start-up data and the SDK at the top of <head> so they
 * run before the site's own code.
 */
export function prepareSiteDocument(html, { boot = null, allowedHosts = [] } = {}) {
  const source = stripSitePreviewShim(html);
  const hosts = normalizeAllowedHosts(allowedHosts);
  const bootData = boot ? { ...boot, allowedHosts: hosts } : (hosts.length ? { allowedHosts: hosts } : null);
  const inject = `<meta http-equiv="Content-Security-Policy" content="${buildSiteCsp(hosts)}">`
    + (bootData ? `<script>window.__SP_SITE_BOOT__=${JSON.stringify(bootData).replace(/</g, '\\u003c')};</script>` : '')
    + `<script>${escapeScript(SP_SITE_SDK_SOURCE)}</script>`;
  const head = source.match(/<head\b[^>]*>/i);
  if (head) return source.slice(0, head.index + head[0].length) + inject + source.slice(head.index + head[0].length);
  const htmlTag = source.match(/<html\b[^>]*>/i);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${source.slice(0, at)}<head>${inject}</head>${source.slice(at)}`;
  }
  const doctype = source.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return doctype[0] + inject + source.slice(doctype[0].length);
  return inject + source;
}

export const SITE_SHIM_START = '<!-- sp-site-preview:start -->';
export const SITE_SHIM_END = '<!-- sp-site-preview:end -->';

/** Remove the preview-only shim; the platform SDK replaces it. */
export function stripSitePreviewShim(html) {
  let text = String(html || '');
  for (;;) {
    const start = text.indexOf(SITE_SHIM_START);
    if (start < 0) return text;
    const end = text.indexOf(SITE_SHIM_END, start);
    if (end < 0) return text;
    text = text.slice(0, start) + text.slice(end + SITE_SHIM_END.length);
  }
}

/** The survey JSON a site embeds for its own preview, if any. */
export function extractEmbeddedScheme(html) {
  const match = String(html || '').match(/<script\b[^>]*id=["']sp-scheme["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return { __invalid: true };
  }
}

/**
 * Static checks on an uploaded site.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkSiteHtml(html, questionNames = [], { allowedHosts = [] } = {}) {
  const hosts = normalizeAllowedHosts(allowedHosts);
  const errors = [];
  const warnings = [];
  const text = stripSitePreviewShim(html);
  const bytes = utf8Bytes(text);
  if (!/<(html|body|div|main|script)\b/i.test(text)) errors.push('index.html does not look like an HTML page.');
  if (bytes > SP_SITE_MAX_BYTES) errors.push(`index.html is ${(bytes / 1048576).toFixed(1)} MB; keep it under 3 MB (media belongs in the Media Dataset).`);
  if (!/SPSite\.answer\s*\(/.test(text)) errors.push('index.html never calls SPSite.answer(...), so no answers would be recorded.');
  if (!/SPSite\.complete\s*\(/.test(text)) errors.push('index.html never calls SPSite.complete(), so participants could not submit.');
  if (/SPSkill\./.test(text)) errors.push('index.html uses the old SPSkill API; use SPSite instead.');
  if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)/.test(text)) {
    const handled = /SPSite\.on(Request|Submit)\s*\(/.test(text);
    if (!handled) {
      warnings.push(hosts.length
        ? `index.html makes network calls; only ${hosts.join(', ')} can be reached, and data sent elsewhere is handed to SPSite.onSubmit instead.`
        : 'index.html makes network calls; they are blocked on the platform. Answers must go through SPSite.answer.');
    }
  }
  const scriptSrc = [...text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const scriptHosts = [...CDN_HOSTS, ...hosts.map((h) => `https://${h}`)];
  const blocked = scriptSrc.filter((src) => !scriptHosts.some((host) => src.startsWith(`${host}/`) || src === host));
  if (blocked.length) {
    errors.push(`Scripts must be inline or come from ${CDN_HOSTS.join(', ')} or an allowed domain: ${blocked.slice(0, 3).join(', ')}.`);
  }
  if (!/getQuestions\s*\(|getQuestion\s*\(|spsite-ready|onReady\s*\(/.test(text)) {
    errors.push('index.html never reads the questions from SPSite (SPSite.onReady / getQuestions), so it cannot show the media the platform drew.');
  }
  const unseen = questionNames.filter((name) => !text.includes(name));
  if (unseen.length && !/getQuestions\s*\(/.test(text)) {
    warnings.push(`index.html never mentions ${unseen.slice(0, 5).join(', ')}; check that these questions are shown.`);
  }
  return { errors, warnings };
}

/** Config without the site page itself, for places that only need the questions (AI assistant context). */
export function withoutSiteHtml(config) {
  if (!config?.spSite?.html) return config;
  const { html, ...meta } = config.spSite;
  return { ...config, spSite: { ...meta, note: 'Participant page built with SP-Scheme; kept by the platform and not editable here.' } };
}

/** External hosts a page loads from or talks to, excluding the built-in CDNs and data: URLs. */
export function externalHostsIn(html) {
  const builtIn = new Set(CDN_HOSTS.map((h) => new URL(h).host).concat(['fonts.googleapis.com', 'fonts.gstatic.com']));
  const found = new Map();
  const add = (url, kind) => {
    try {
      const { host, protocol } = new URL(url);
      if (!/^https?:$/.test(protocol) || builtIn.has(host)) return;
      const entry = found.get(host) || { host, kinds: new Set() };
      entry.kinds.add(kind);
      found.set(host, entry);
    } catch { /* relative or invalid */ }
  };
  const text = String(html || '');
  for (const m of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(m[1], 'script');
  for (const m of text.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)) add(m[1], 'style');
  for (const m of text.matchAll(/\b(?:fetch|open|sendBeacon|axios\.\w+|\$\.(?:ajax|get|post|getJSON))\s*\(\s*(?:['"]\w+['"]\s*,\s*)?['"`](https?:\/\/[^'"`\s]+)/g)) add(m[1], 'request');
  for (const m of text.matchAll(/['"`](https?:\/\/[^'"`\s]+\/(?:tiles?|api|v\d+)\/[^'"`\s]*)['"`]/gi)) add(m[1], 'request');
  return [...found.values()].map((e) => ({ host: e.host, kinds: [...e.kinds] }));
}
