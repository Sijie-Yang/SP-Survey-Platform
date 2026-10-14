/**
 * Convert an existing survey page (any HTML survey, including ones that post
 * results to their own server) into an SP-Scheme site.
 *
 * The Assistant model returns native questions, an adapter script and exact
 * find/replace patches (see worker-lib/agent/spSchemeConvert.mjs). They are
 * applied here and the result goes through the same validation as an
 * uploaded SP-Scheme page; failures are sent back to the model for a fix.
 */

import { buildConvertReference, SP_SCHEME_FORMAT, SP_SCHEME_VERSION, validateSpSchemePackage } from './spScheme';
import { externalHostsIn, normalizeAllowedHosts, stripSitePreviewShim } from './spSite';
import { smokeMedia, smokeQuestions } from './spSiteSmoke';

export const CONVERT_MAX_HTML_CHARS = 200000;

/**
 * Questions the checks rejected are kept as records instead of dropped: their
 * type becomes "custom" (any value, stored as is, not analysed), so the page
 * still runs and the researcher analyses those answers from the export.
 * @returns {{ survey: object, degraded: { name: string, reason: string }[] }}
 */
export function degradeRejectedQuestions(survey, errors = [], problems = []) {
  const out = JSON.parse(JSON.stringify(survey || { pages: [] }));
  const degraded = [];
  const byName = new Map();
  const walk = (elements) => (elements || []).forEach((el, i, list) => {
    if (!el || typeof el !== 'object') return;
    if (el.name) byName.set(el.name, { el, list, i });
    walk(el.elements);
  });
  (out.pages || []).forEach((page) => walk(page?.elements));
  const degrade = (name, reason) => {
    const hit = byName.get(name);
    if (!hit || hit.el.type === 'custom' || degraded.some((d) => d.name === name)) return;
    const { el, list, i } = hit;
    list[i] = { type: 'custom', name: el.name, ...(el.title ? { title: el.title } : {}), ...(el.description ? { description: el.description } : {}), ...(el.isRequired ? { isRequired: true } : {}) };
    degraded.push({ name, reason });
  };
  const elementAt = (path) => {
    const page = /survey\.pages\[(\d+)\]/.exec(path);
    if (!page) return null;
    let list = out.pages?.[Number(page[1])]?.elements;
    let el = null;
    for (const m of path.slice(page.index + page[0].length).matchAll(/\.elements\[(\d+)\]/g)) {
      el = list?.[Number(m[1])] || null;
      list = el?.elements;
    }
    return el;
  };
  errors.forEach((e) => {
    const el = elementAt(String(e.path || ''));
    if (el?.name) degrade(el.name, e.message);
  });
  problems.forEach((text) => {
    const m = /^([\w.-]+): /.exec(String(text));
    if (m && byName.has(m[1])) degrade(m[1], text);
  });
  return { survey: out, degraded };
}

/**
 * The page as it is, with no questions declared: the platform keeps every
 * request it sends and the researcher analyses the export. Used when the
 * model's conversion cannot be made to pass, and offered as a choice.
 */
export function rawConversionResult(result = null, { keepAdapter = false } = {}) {
  return {
    survey: { pages: [], ...(result?.survey?.mediaFolders ? { mediaFolders: result.survey.mediaFolders } : {}) },
    adapterScript: keepAdapter ? String(result?.adapterScript || '') : '',
    replacements: keepAdapter ? (result?.replacements || []) : [],
    externalHosts: result?.externalHosts || [],
    originalImages: result?.originalImages || [],
    mediaGroups: result?.mediaGroups || [],
    notes: ['Imported as it is: no questions declared, the platform records the requests the page sends and does not analyse them.'],
  };
}
// The model gets one pass. Questions it gets wrong are recorded as they are
// (custom) rather than sent back for fixing; set this above 0 to allow fix rounds.
export const CONVERT_FIX_ROUNDS = 0;

const DATA_URI_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=\s]{200,}/gi;
const TOKEN_RE = /data:sp-token\/(\d+)/g;

/** Long embedded images waste the model's context; swap them for short tokens. */
export function tokenizeDataUris(html) {
  const tokens = [];
  const out = String(html || '').replace(DATA_URI_RE, (match) => {
    tokens.push(match);
    return `data:sp-token/${tokens.length - 1}`;
  });
  return { html: out, tokens };
}

export function restoreDataUris(text, tokens = []) {
  return String(text || '').replace(TOKEN_RE, (match, i) => tokens[Number(i)] ?? match);
}

function escapeJsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function escapeScriptText(text) {
  return String(text).replace(/<\/script/gi, '<\\/script');
}

function insertAfterHeadOpen(html, block) {
  const head = html.match(/<head\b[^>]*>/i);
  if (head) return html.slice(0, head.index + head[0].length) + block + html.slice(head.index + head[0].length);
  const htmlTag = html.match(/<html\b[^>]*>/i);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${html.slice(0, at)}<head>${block}</head>${html.slice(at)}`;
  }
  return block + html;
}

function insertBeforeBodyClose(html, block) {
  const at = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  return at >= 0 ? html.slice(0, at) + block + html.slice(at) : html + block;
}

/**
 * Apply one model answer to the page the model saw (data URIs tokenized).
 * @returns {{ html: string, pkg: object, problems: string[] }}
 */
export function applyConversion(tokenizedHtml, result, tokens = [], { mediaFiles = [], mediaBase = '' } = {}) {
  const problems = [];
  let html = stripSitePreviewShim(String(tokenizedHtml || ''));
  (result?.replacements || []).forEach(({ find, replace }, i) => {
    const at = html.indexOf(find);
    if (at < 0) {
      problems.push(`replacements[${i}].find was not found in the page; copy it exactly or drop it: ${JSON.stringify(find.slice(0, 120))}`);
      return;
    }
    if (html.indexOf(find, at + find.length) >= 0) {
      problems.push(`replacements[${i}].find occurs more than once; make it unique: ${JSON.stringify(find.slice(0, 120))}`);
      return;
    }
    html = html.slice(0, at) + replace + html.slice(at + find.length);
  });
  // An old embedded block would shadow the converted questions.
  html = html.replace(/<script\b[^>]*\bid=["']sp-scheme["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const survey = result?.survey ? JSON.parse(JSON.stringify(result.survey)) : null;
  // Models often leave out page names; they carry no meaning for a site.
  (survey?.pages || []).forEach((page, i) => {
    if (page && typeof page === 'object' && !page.name) page.name = `page${i + 1}`;
  });
  // The media library mirrors the zip's own folders; the page applies its own
  // assignment (its config) to them, so the model does not regroup files.
  const mediaPlan = mediaFiles.length ? planMediaUpload(mediaFiles, [], mediaBase) : null;
  if (mediaPlan) {
    problems.push(...mediaPlan.problems);
    if (survey && !(Array.isArray(survey.mediaFolders) && survey.mediaFolders.length)) {
      survey.mediaFolders = [...mediaPlan.folders.keys()];
    }
    problems.push(...linkQuestionFolders(survey, mediaPlan));
  }
  const pkg = { format: SP_SCHEME_FORMAT, spScheme: SP_SCHEME_VERSION, survey };
  html = insertAfterHeadOpen(html, `\n<script type="application/json" id="sp-scheme">\n${escapeJsonForScript(pkg)}\n</script>\n`);
  const adapter = String(result?.adapterScript || '').trim();
  const declared = (survey?.pages || []).some((page) => (page?.elements || []).length);
  if (adapter) {
    html = insertBeforeBodyClose(html, `\n<script data-sp-adapter>\n${escapeScriptText(adapter)}\n</script>\n`);
  } else if (declared) {
    problems.push('adapterScript is empty: the page must record answers with SPSite.answer and finish with SPSite.complete().');
  }
  return { html: restoreDataUris(html, tokens), pkg, problems, mediaPlan };
}

const FOLDER_RE = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i;

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : 'files';
}

/** A short media-library folder for an import ("sp-scheme/retail_validation_r10_mac"). */
export function importMediaBase(name) {
  const stem = String(name || 'import').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return `sp-scheme/${stem.slice(0, 60) || 'import'}`;
}

/**
 * Where each stimulus file from the zip goes in the media library: the model's
 * groups first, then the file's own folder.
 * @returns {{ files: { path, folder }[], folders: Map<string, { full, count }>, problems: string[] }}
 */
export function planMediaUpload(mediaFiles, groups = [], base = '') {
  const problems = [];
  const known = new Set(mediaFiles.map((f) => f.path));
  const byBase = new Map();
  mediaFiles.forEach((f) => {
    const name = f.path.split('/').pop();
    byBase.set(name, byBase.has(name) ? null : f.path);
  });
  const assigned = new Map();
  (groups || []).forEach((group, gi) => {
    const folder = String(group.folder || '').replace(/^\/+|\/+$/g, '');
    if (!FOLDER_RE.test(folder)) {
      problems.push(`mediaGroups[${gi}].folder "${group.folder}" is not a short relative folder name of letters, digits, _ and -.`);
      return;
    }
    const missing = [];
    (group.files || []).forEach((file) => {
      const path = known.has(file) ? file : byBase.get(String(file).split('/').pop());
      if (!path) { missing.push(file); return; }
      if (!assigned.has(path)) assigned.set(path, folder);
    });
    if (missing.length) {
      problems.push(`mediaGroups[${gi}] lists ${missing.length} file(s) that are not in MEDIA FILES, e.g. ${missing.slice(0, 3).join(', ')}.`);
    }
  });
  const folders = new Map();
  const files = mediaFiles.map((f) => {
    const rel = assigned.get(f.path) || dirOf(f.path).replace(/[^a-z0-9_/-]+/gi, '_');
    const full = base ? `${base}/${rel}` : rel;
    const entry = folders.get(rel) || { full, count: 0 };
    entry.count += 1;
    folders.set(rel, entry);
    return { ...f, folder: full };
  });
  return { files, folders, problems };
}

function eachElement(survey, fn) {
  const walk = (elements) => (elements || []).forEach((el) => {
    if (!el || typeof el !== 'object') return;
    fn(el);
    walk(el.elements);
  });
  (survey?.pages || []).forEach((page) => walk(page?.elements));
}

/** Point questions at the uploaded folders; report folders that will be empty or too small. */
function linkQuestionFolders(survey, plan) {
  const problems = [];
  if (survey && Array.isArray(survey.mediaFolders)) {
    survey.mediaFolders = survey.mediaFolders.map((folder) => {
      const rel = String(folder || '').replace(/^\/+|\/+$/g, '');
      const hit = plan.folders.get(rel);
      if (!hit) problems.push(`survey.mediaFolders "${folder}" has no files; use one of: ${[...plan.folders.keys()].join(', ')}.`);
      return hit ? hit.full : folder;
    });
  }
  eachElement(survey, (el) => {
    if (!Array.isArray(el.mediaFolders) || !el.mediaFolders.length) return;
    let available = 0;
    el.mediaFolders = el.mediaFolders.map((folder) => {
      const rel = String(folder || '').replace(/^\/+|\/+$/g, '');
      const hit = plan.folders.get(rel);
      if (!hit) {
        problems.push(`${el.name}: mediaFolders "${folder}" has no files; use one of: ${[...plan.folders.keys()].join(', ')}.`);
        return folder;
      }
      available += hit.count;
      return hit.full;
    });
    const needed = (Number(el.trialCount) || 1) * (Number(el.imageCount) || 1);
    if (available && el.excludePreviouslyUsedImages !== false && needed > available) {
      problems.push(`${el.name}: shows ${needed} files without repeats but its folders hold only ${available}; lower trialCount or imageCount.`);
    }
  });
  return problems;
}

/**
 * Domains the page references plus the ones the model says it needs.
 * `needed` marks hosts the page loads code, styles or data from; hosts that
 * only received results are not needed, because results go through SPSite.
 */
export function candidateHosts(html, result) {
  const found = new Map();
  externalHostsIn(html).forEach(({ host, kinds }) => {
    found.set(host, { host, why: kinds.join(', '), needed: kinds.some((k) => k !== 'request') });
  });
  (result?.externalHosts || []).forEach(({ host, why }) => {
    const [clean] = normalizeAllowedHosts([host]);
    if (!clean) return;
    const entry = found.get(clean) || { host: clean, why: '' };
    found.set(clean, { ...entry, why: why || entry.why, needed: true });
  });
  return [...found.values()];
}

/**
 * Convert a page with the Assistant model, retrying with the validation
 * errors. `request` posts to /api/agent/sp-scheme/convert.
 */
export async function convertSurveyHtml(originalHtml, {
  request, notes = '', dataFiles = [], mediaFiles: givenMedia = [], mediaBase = '', fetchMedia = null, smokeTest = null, onProgress,
} = {}) {
  let mediaFiles = givenMedia;
  let mediaRoundUsed = false;
  const source = stripSitePreviewShim(String(originalHtml || ''));
  const tokenized = tokenizeDataUris(source);
  if (tokenized.html.length > CONVERT_MAX_HTML_CHARS) {
    throw new Error(`The page is too long to convert automatically (${tokenized.html.length} characters; the limit is ${CONVERT_MAX_HTML_CHARS}).`);
  }
  const reference = buildConvertReference();
  let previous = null;
  let feedback = [];
  let last = null;
  // One extra round when the page's stimuli are downloaded after the first answer.
  const lastRound = CONVERT_FIX_ROUNDS + (fetchMedia ? 1 : 0);
  const startCheck = async (html, pkg, mediaPlan, hostList) => {
    // Load the page once, the way participants get it, and report errors or
    // requests it never answers. This is shown to the researcher, not fixed.
    if (!smokeTest) return [];
    onProgress?.({ round: lastRound, stage: 'run', fixing: false, feedback });
    const run = await smokeTest(html, {
      questions: smokeQuestions(pkg?.survey, mediaPlan),
      media: smokeMedia(pkg?.survey, mediaPlan),
      allowedHosts: hostList.map((h) => h.host),
    });
    return run?.problems || [];
  };
  for (let round = 0; round <= lastRound; round += 1) {
    onProgress?.({ round, stage: 'model', fixing: round > 0, feedback });
    const response = await request({ html: tokenized.html, reference, notes, dataFiles, mediaFiles: mediaFiles.map((f) => f.path), previous, feedback });
    if (response?.success === false) throw new Error(response.error || 'The conversion request failed.');
    const result = response?.result;
    if (!result) throw new Error('The model returned nothing usable.');
    onProgress?.({ round, stage: 'check', fixing: round > 0, feedback });
    const applied = applyConversion(tokenized.html, result, tokenized.tokens, { mediaFiles, mediaBase });
    const hosts = candidateHosts(applied.html, result);
    // Validate as if every candidate domain were allowed; the researcher then
    // chooses which ones to allow and the import re-checks that choice.
    const report = validateSpSchemePackage(applied.pkg, {
      siteHtml: applied.html,
      allowedHosts: hosts.map((h) => h.host),
    });
    const problems = [...applied.problems, ...report.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))];
    last = { html: applied.html, pkg: applied.pkg, mediaPlan: applied.mediaPlan, report, problems, hosts, result, rounds: round + 1, provider: response.provider, model: response.model };
    if (fetchMedia && !mediaRoundUsed && !mediaFiles.length && result.originalImages?.length && round < lastRound) {
      // A page from the web: bring its stimuli into the media library and let
      // the model draw them like the files of a project zip.
      mediaRoundUsed = true;
      onProgress?.({ round, stage: 'media', total: result.originalImages.length, feedback });
      const total = result.originalImages.length;
      const shown = feedback;
      const progress = (done) => onProgress?.({ round, stage: 'media', done, total, feedback: shown });
      // eslint-disable-next-line no-await-in-loop
      const got = await fetchMedia(result.originalImages.map((img) => img.url), progress);
      if (got.files.length) {
        mediaFiles = got.files;
        previous = result;
        feedback = [
          `The page's ${got.files.length} stimulus files were downloaded and are now MEDIA FILES (listed below). They are uploaded in folders mirroring their paths; have the page draw them with SPSite.getMedia("<folder>") (or mediaFolders when the page has no drawing logic of its own), and leave originalImages empty.`,
          ...(got.failed.length ? [`${got.failed.length} file(s) could not be downloaded: ${got.failed.slice(0, 3).join(', ')}.`] : []),
          ...problems.slice(0, 28),
        ];
        continue; // eslint-disable-line no-continue
      }
    }
    if (!problems.length) {
      // eslint-disable-next-line no-await-in-loop
      const startProblems = await startCheck(applied.html, applied.pkg, applied.mediaPlan, hosts);
      return { ...last, ok: true, startProblems };
    }
    previous = result;
    feedback = problems.slice(0, 30);
  }
  // Questions the checks still reject are recorded as they are (custom) so the
  // page can be imported with every other question analysed as usual.
  const rejected = degradeRejectedQuestions(last.result?.survey, last.report?.errors || [], last.problems);
  if (rejected.degraded.length) {
    const result = { ...last.result, survey: rejected.survey };
    const applied = applyConversion(tokenized.html, result, tokenized.tokens, { mediaFiles, mediaBase });
    const hosts = candidateHosts(applied.html, result);
    const report = validateSpSchemePackage(applied.pkg, { siteHtml: applied.html, allowedHosts: hosts.map((h) => h.host) });
    const problems = [...applied.problems, ...report.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))];
    if (!problems.length) {
      const startProblems = await startCheck(applied.html, applied.pkg, applied.mediaPlan, hosts);
      return { ...last, html: applied.html, pkg: applied.pkg, mediaPlan: applied.mediaPlan, report, problems: [], hosts, result, ok: true, degraded: rejected.degraded, startProblems };
    }
  }
  // The questions the model declared cannot be used: offer the page as it is
  // (raw records), keeping the model's adapter when it still passes the checks
  // (it may be what answers the page's own server requests), else without it.
  const hostList = last.hosts.map((h) => h.host);
  let raw = null;
  for (const rawResult of [rawConversionResult(last?.result, { keepAdapter: true }), rawConversionResult(last?.result)]) {
    const candidate = applyConversion(tokenized.html, rawResult, tokenized.tokens, { mediaFiles, mediaBase });
    const report = validateSpSchemePackage(candidate.pkg, { siteHtml: candidate.html, allowedHosts: hostList });
    const problems = [...candidate.problems, ...report.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))];
    if (!problems.length) {
      // eslint-disable-next-line no-await-in-loop
      const startProblems = await startCheck(candidate.html, candidate.pkg, candidate.mediaPlan, last.hosts);
      raw = { html: candidate.html, pkg: candidate.pkg, mediaPlan: candidate.mediaPlan, report, result: rawResult, startProblems };
      break;
    }
  }
  return { ...last, ok: false, raw };
}
