/**
 * Writes or changes an SP-Scheme page for the in-browser Assistant's
 * SP-Scheme mode (tool sp_scheme_write_page).
 *
 * The model only writes text. Whether the page is usable is decided by the
 * same deterministic check Studio runs on a dropped file
 * (src/lib/spSchemeImport.js); when that check finds problems, the problems
 * go back to the model for a fixed number of repair rounds, and the best page
 * is returned with whatever problems remain. The tool saves it only when it
 * passes.
 *
 * When the study's media library is passed in, the model is told what it
 * holds (folders, file names, counts) and writes the page for it. A page that
 * still asks for a folder or a file the library lacks gets one more round to
 * fit; what remains comes back as mediaNotes and does not block saving (the
 * researcher may upload those files later).
 */

import { strToU8 } from 'fflate';
import { buildSpSchemeText, readSpSchemeUpload } from '../../src/lib/spScheme.js';
import { prepareSpSchemeUpload, summarizeSpSchemeImport } from '../../src/lib/spSchemeImport.js';
import { mediaLibraryBrief, mediaLibraryText, pageMediaGaps } from '../../src/lib/spSchemeMediaBrief.js';

export const MAX_REQUEST_CHARS = 20000;
export const MAX_CURRENT_HTML_CHARS = 200000;
export const MAX_REPAIR_ROUNDS = 2;
const MAX_REPLY_CHARS = 1200;
const MAX_OUTPUT_TOKENS = 32000;

const BUILT_IN_RULES = `

## How to answer here

You write the study page for SP-Survey's built-in Assistant. The request below comes from a researcher who cannot see code.
- First one or two short sentences, in the researcher's language, saying what you made or changed; then one \`\`\`html block holding the whole index.html. Nothing after the block.
- The page must work on its own: no external scripts, stylesheets, fonts or CDNs; plain HTML, CSS and JavaScript inline.
- Do not hard-code image URLs. Declare the media folders the study needs. When the message lists the study's media library, fit the page to what it holds; otherwise the researcher uploads the images afterwards.
- Write what participants read in the language the researcher writes in, unless they ask for another language.
- Keep it simple and tidy: a clear welcome with consent, the tasks, and a short end. Works on phones.
- If the researcher pasted an existing survey, keep its questions and wording and fit it to SP-Scheme.`;

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

/** What the model said before the page: its short note to the researcher. */
export function extractReply(text) {
  const raw = String(text || '');
  const cut = [raw.search(/```/), raw.search(/<!doctype html|<html[\s>]/i)].filter((i) => i >= 0);
  const before = cut.length ? raw.slice(0, Math.min(...cut)) : raw;
  return before.trim().slice(0, MAX_REPLY_CHARS);
}

/** The page inside the model's answer: the ```html block, or the bare document. */
export function extractHtml(text) {
  const raw = String(text || '');
  const fences = [...raw.matchAll(/```(?:html|HTML)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fenced = fences.sort((a, b) => b.length - a.length)[0];
  const source = fenced && /<html[\s>]/i.test(fenced) ? fenced : raw;
  const start = source.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return '';
  const end = source.toLowerCase().lastIndexOf('</html>');
  const html = end > start ? source.slice(start, end + '</html>'.length) : source.slice(start);
  return html.trim();
}

/** Studio's import check on a page, in the JSON-safe summary shape. */
export function checkGeneratedPage(html) {
  try {
    const prepared = prepareSpSchemeUpload(readSpSchemeUpload(strToU8(html)), { name: 'index.html' });
    return summarizeSpSchemeImport(prepared);
  } catch (error) {
    return { ok: false, asIs: true, problems: [{ path: '', message: error?.message || String(error) }] };
  }
}

/** Lower is better: unusable pages first, then pages imported as-is, then the problem count. */
export function pageScore(summary) {
  if (!summary) return Infinity;
  return (summary.ok ? 0 : 1000) + (summary.asIs ? 100 : 0) + (summary.problems?.length || 0);
}

const NOT_SP_SCHEME = {
  path: 'index.html',
  message: 'The page is not SP-Scheme yet: embed the survey JSON (<script type="application/json" id="sp-scheme">) declaring every question, record every answer with SPSite.answer(...) and finish with SPSite.complete().',
};

/**
 * What still has to change: the check's problems, and for a page that would be
 * imported as-is (or declares no questions) also why, so the model can fix it.
 */
export function pageFixList(summary) {
  const list = [...(summary?.problems || [])];
  if (summary?.asIs || summary?.matchLevel === 'none') {
    list.push(NOT_SP_SCHEME);
    for (const warning of summary?.warnings || []) list.push(warning);
  }
  return list;
}

function problemsMessage(problems) {
  return [
    'The platform checked your page and found these problems:',
    ...problems.slice(0, 30).map((p) => `- ${p.message}${p.path ? ` (${p.path})` : ''}`),
    '',
    'Fix all of them and answer with the complete corrected index.html in one ```html block.',
  ].join('\n');
}

export function buildFirstMessage({ request, currentHtml, libraryText = '' }) {
  const library = libraryText ? [libraryText, ''] : [];
  if (!currentHtml) return [...library, request].join('\n');
  return [
    'Here is the current index.html of this study:',
    '```html',
    currentHtml,
    '```',
    '',
    ...library,
    'Change it as follows and answer with the complete updated index.html:',
    request,
  ].join('\n');
}

function mediaGapsMessage(gaps) {
  return [
    'The platform compared your page with the study\'s media library:',
    ...gaps.map((gap) => `- ${gap.message}`),
    '',
    'Fit the page to the library (keep a folder or file the researcher asked for by name) and answer with the complete corrected index.html in one ```html block.',
  ].join('\n');
}

/**
 * Write (or change) a page with the given model route. Returns the best page
 * found, the model's short note on it and Studio's check; `rounds` counts the
 * model calls.
 * @param {{ chat: Function, route: object, request: string, currentHtml?: string, mediaLibrary?: object[], mediaPrefix?: string }} input
 *   route = { apiKey, provider, baseUrl, model, modelRecord, protocol, compat, extra }
 *   mediaLibrary = the study's media list (projects.preloaded_images); leave out when there is no study yet
 */
export async function writeSpSchemePage({ chat, route, request, currentHtml = '', mediaLibrary = null, mediaPrefix = null }) {
  const text = String(request || '').trim();
  if (!text) throw fail('Say what the page should be or what to change.');
  if (text.length > MAX_REQUEST_CHARS) throw fail(`The request is too long (over ${MAX_REQUEST_CHARS} characters).`);
  const html0 = typeof currentHtml === 'string' ? currentHtml : '';
  if (html0.length > MAX_CURRENT_HTML_CHARS) throw fail('The current page is too large for the built-in AI to edit.');

  const knowsLibrary = Array.isArray(mediaLibrary);
  const libraryText = knowsLibrary ? mediaLibraryText(mediaLibraryBrief(mediaLibrary, mediaPrefix)) : '';
  const gapsOf = (html) => (knowsLibrary && html ? pageMediaGaps(html, mediaLibrary, mediaPrefix) : []);
  let askedToFitLibrary = false;

  const messages = [
    { role: 'system', content: buildSpSchemeText() + BUILT_IN_RULES },
    { role: 'user', content: buildFirstMessage({ request: text, currentHtml: html0, libraryText }) },
  ];
  let best = null;
  let reply = '';
  let rounds = 0;
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    rounds += 1;
    const result = await chat({
      ...route,
      temperature: 0.2,
      maxTokens: Math.min(Number(route.modelRecord?.maxTokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
      messages,
    });
    const answer = String(result?.content || '');
    const html = extractHtml(answer);
    if (round === 0) reply = extractReply(answer);
    const summary = html
      ? checkGeneratedPage(html)
      : { ok: false, asIs: true, problems: [{ path: '', message: 'The answer did not contain an HTML page.' }] };
    const gaps = gapsOf(html);
    const score = pageScore(summary) + gaps.length;
    if (html && (!best || score < best.score)) best = { html, summary, gaps, score };
    const fixes = pageFixList(summary);
    const pageFine = summary.ok && !fixes.length;
    // A page that passes but does not fit the library gets one round to fit it.
    const fitLibrary = pageFine && gaps.length > 0 && !askedToFitLibrary;
    if ((pageFine && !fitLibrary) || round === MAX_REPAIR_ROUNDS) break;
    messages.push({ role: 'assistant', content: answer.slice(0, 200000) || '(empty answer)' });
    if (fitLibrary) {
      askedToFitLibrary = true;
      messages.push({ role: 'user', content: mediaGapsMessage(gaps) });
    } else {
      messages.push({ role: 'user', content: problemsMessage(fixes) });
    }
  }
  if (!best) return { html: '', reply, rounds, passed: false, check: { ok: false, asIs: true, matchLevel: 'none', problems: [{ path: '', message: 'The AI did not return a page.' }], mediaNotes: [] } };
  const problems = pageFixList(best.summary);
  return {
    html: best.html,
    reply,
    rounds,
    passed: Boolean(best.summary.ok && !best.summary.asIs),
    check: {
      ok: best.summary.ok,
      asIs: best.summary.asIs,
      matchLevel: best.summary.matchLevel || 'none',
      title: best.summary.title || '',
      questionCount: best.summary.questionCount || 0,
      problems,
      // What the page asks of the media library that is not there (never blocks saving).
      mediaNotes: best.gaps.map((gap) => gap.message),
    },
  };
}
