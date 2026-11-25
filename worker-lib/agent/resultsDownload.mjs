/**
 * One ZIP with a project's data, for agents to analyse directly
 * (survey_download_url → GET /api/mcp/download/<token>).
 *
 * The rows and the main files are the ones Studio's "Download data" builds,
 * with the Results page's default filters: silicon runs never, the
 * researcher's own practice runs only when asked (or when the survey includes
 * them). A page imported as it is gets the Results page's site export; any
 * other survey the wide CSV and the raw JSON. Every ZIP adds stimuli.csv,
 * survey.json, page.html (for a page) and the citation files.
 *
 * Memory (a Worker has 128 MB): loading stops at DOWNLOAD_MAX_ROWS rows or
 * DOWNLOAD_MAX_JSON_BYTES of response JSON, and the ZIP is streamed one entry
 * at a time as the client reads it, so the CSV, the JSON and their copies are
 * never all in memory together.
 */

import { Zip, ZipDeflate, strToU8, zipSync } from 'fflate';
import { recordedSurveyConfig } from '../../src/lib/recordedSurvey.js';
import { buildResponsesWideCsv } from '../../src/lib/responsesWideExport.js';
import { buildSiteResultsExportFiles } from '../../src/lib/questionSummaryExport.js';
import { howToCiteLines, platformBibtex, resultsCitationCff } from '../../src/lib/platformCitation.js';
import { exportDateStamp, rowsToCsv } from '../../src/lib/csvUtil.js';
import { inferMediaType } from '../../src/lib/mediaUtils.js';
import { isSafeProjectId, sanitizeForAgent } from '../designProtocol.mjs';
import { loadOwned } from './projectLifecycle.mjs';
import { fetchAllResponses } from './resultsHandlers.mjs';
import { countProjectResponses } from '../adminResults.mjs';
import {
  DOWNLOAD_PATH_PREFIX,
  DOWNLOAD_TOKEN_TTL_SECONDS,
  signTransferToken,
} from '../mcp/transferTokens.mjs';

export const DOWNLOAD_MAX_ROWS = 20000;
/** Most response JSON one download reads from the database. */
export const DOWNLOAD_MAX_JSON_BYTES = 32 * 1024 * 1024;

const USE_SITE_EXPORT = 'Use the CSV export on the project\'s Results page in the site instead.';

/** The config participants answer: the release once the project is version-managed, else the draft. */
export function participantConfig(row) {
  if (row?.release_managed && row.survey_config_published) return row.survey_config_published;
  return row?.survey_config_draft ?? row?.survey_config ?? {};
}

/** The media library participants draw from (the released one once managed). */
export function participantLibrary(row) {
  const released = row?.release_managed ? row.published_media?.preloadedImages : null;
  if (Array.isArray(released)) return released;
  return Array.isArray(row?.preloaded_images) ? row.preloaded_images : [];
}

function isSilicon(row) {
  return row?.source === 'silicon' || Boolean(row?.survey_metadata?.silicon_run_id);
}

/** Studio's and the Results page's default rows. */
export function downloadRows(responses = [], config = {}, includePractice = false) {
  const practice = includePractice === true || config?.includeResearcherPractice === true;
  return (Array.isArray(responses) ? responses : [])
    .filter((row) => !isSilicon(row))
    .filter((row) => practice || !row?.survey_metadata?.practice_mode);
}

function hasSitePage(config) {
  return typeof config?.spSite?.html === 'string' && config.spSite.html.length > 0;
}

/** File names the ZIP will hold for this project (before any rows are read). */
export function dataFileNames(row) {
  const config = participantConfig(row);
  const site = hasSitePage(config);
  return [
    'README.txt',
    'responses_wide.csv',
    'responses_raw.json',
    'stimuli.csv',
    'survey.json',
    ...(site ? ['page.html'] : []),
    'references.bib',
    'CITATION.cff',
  ];
}

function stimuliCsv(library) {
  const rows = [['folder', 'name', 'url', 'type']];
  (library || []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const url = String(entry.url || '');
    const name = String(entry.name || url.split('?')[0].split('/').pop() || '');
    if (!url && !name) return;
    rows.push([String(entry.folder ?? entry.logicalFolder ?? ''), name, url, String(entry.type || inferMediaType(name || url))]);
  });
  return rowsToCsv(rows);
}

const EXTRA_FILE_LINES = (site) => [
  'stimuli.csv          the project\'s media library: folder, name, url, type (one row per file)',
  `survey.json          the questionnaire these answers were recorded with${site ? ' (the page itself is page.html)' : ''}`,
  ...(site ? ['page.html            the page participants saw'] : []),
  'references.bib       how to cite SP-Survey (BibTeX)',
  'CITATION.cff         citation metadata for this data set',
];

function rowsNote(n, practice) {
  return `Submissions: ${n} (silicon pretest runs are never included; the researcher's own practice runs are ${practice ? 'included' : 'left out'})`;
}

function nativeReadme({ project, n, practice, site }) {
  return [
    `SP-Survey data · ${project?.name || project?.id || 'survey'} · ${exportDateStamp()}`,
    '',
    'Files',
    'responses_wide.csv   one row per submission, one column per recorded answer',
    'responses_raw.json   every submission exactly as stored (answers, shown media, metadata)',
    ...EXTRA_FILE_LINES(site),
    '',
    'Columns of responses_wide.csv',
    'participant_id, created_at          who answered, and when (UTC)',
    'completion_code, session_id, attempt_index',
    'practice_mode                       true for the researcher\'s own test runs',
    'quality_flags                       automatic quality checks, separated by |; empty when none',
    'survey_revision                     the saved version of the questionnaire that was answered',
    '<question>                          the answer to that question; names and wording are in survey.json',
    '<question>__<item>                  one column per item, slider or row of a multi-part question',
    '<question>__trial_count, __trials_json        repeated trials of a media question',
    '<question>__shown_images, __shown_media, ...  the stimuli this participant saw',
    ...(site ? ['__sp_page_state, __sp_requests     what the page itself saved and sent, as JSON'] : []),
    '',
    rowsNote(n, practice),
    '',
    ...howToCiteLines(),
    '',
  ].join('\n');
}

/**
 * responses_raw.json in pieces of about `pieceChars` characters: together
 * exactly `${JSON.stringify(rows, null, 2)}\n`, without holding all of it.
 */
export function* rawJsonPieces(rows, pieceChars = 256 * 1024) {
  if (!rows.length) {
    yield '[]\n';
    return;
  }
  let piece = '[';
  for (let i = 0; i < rows.length; i += 1) {
    // JSON text has no raw line breaks inside strings, so indenting every line is safe.
    piece += `${i ? ',' : ''}\n  ${JSON.stringify(rows[i] ?? null, null, 2).replace(/\n/g, '\n  ')}`;
    if (piece.length >= pieceChars) {
      yield piece;
      piece = '';
    }
  }
  yield `${piece}\n]\n`;
}

/** A file's text: `content` is a string, or a function that returns its pieces. */
export function fileText(file) {
  return typeof file.content === 'function' ? [...file.content()].join('') : String(file.content ?? '');
}

/**
 * The ZIP's files (paths relative to its folder). The two large files
 * (responses_wide.csv, responses_raw.json) are built only when read: their
 * `content` is a function returning the text in pieces. Use fileText() to get
 * a file's whole text.
 * @param {{ row: object, responses: object[], includePractice?: boolean }} args
 * @returns {{ path: string, content: string|(() => Iterable<string>) }[]}
 */
export function buildDataFiles({ row, responses, includePractice = false }) {
  const config = participantConfig(row);
  const practice = includePractice === true || config?.includeResearcherPractice === true;
  const rows = downloadRows(responses, config, includePractice);
  const recorded = recordedSurveyConfig(rows, config || {});
  const questions = (recorded?.pages || []).flatMap((page) => page?.elements || []);
  const wideCsv = () => [buildResponsesWideCsv(rows, questions, recorded)];
  const rawJson = () => rawJsonPieces(rows);
  const project = { id: row?.id, name: row?.name || '' };
  const site = hasSitePage(config);

  const { spSite, ...rest } = sanitizeForAgent(recorded || {});
  const surveyJson = spSite && typeof spSite === 'object'
    ? { ...rest, spSite: (({ html, ...meta }) => meta)(spSite) }
    : rest;
  const extras = [
    { path: 'stimuli.csv', content: stimuliCsv(participantLibrary(row)) },
    { path: 'survey.json', content: `${JSON.stringify(surveyJson, null, 2)}\n` },
    ...(site ? [{ path: 'page.html', content: config.spSite.html }] : []),
  ];

  if (recorded?.spSite?.convertedFrom) {
    // The Results page's export for a page imported as it is, plus the extras.
    // Its builder is asked for the small files only (no rows); the row count
    // in its README is replaced below and the two large files are built lazily.
    const files = buildSiteResultsExportFiles({ project, filteredResponses: [], wideCsv: '' }).map((f) => {
      if (f.path === 'responses_wide.csv') return { ...f, content: wideCsv };
      if (f.path === 'responses_raw.json') return { ...f, content: rawJson };
      return f;
    });
    const readme = files.find((f) => f.path === 'README.txt');
    if (readme) {
      const lines = `${EXTRA_FILE_LINES(site).join('\n')}\n`;
      readme.content = readme.content.includes('\n\nSubmissions:')
        ? readme.content.replace('\n\nSubmissions:', `\n${lines}\nSubmissions:`)
        : `${readme.content}\n${lines}`;
      readme.content = readme.content.replace(/^Submissions: .*$/m, rowsNote(rows.length, practice));
    }
    const before = files.filter((f) => !['references.bib', 'CITATION.cff'].includes(f.path));
    const after = files.filter((f) => ['references.bib', 'CITATION.cff'].includes(f.path));
    return [...before, ...extras, ...after];
  }

  return [
    { path: 'README.txt', content: nativeReadme({ project, n: rows.length, practice, site }) },
    { path: 'responses_wide.csv', content: wideCsv },
    { path: 'responses_raw.json', content: rawJson },
    ...extras,
    { path: 'references.bib', content: platformBibtex() },
    { path: 'CITATION.cff', content: resultsCitationCff({ project, releaseDate: exportDateStamp() }) },
  ];
}

export function dataZipFolder(projectId) {
  return `results_${projectId || 'survey'}_${exportDateStamp()}`;
}

/** The ZIP bytes for the files, inside one folder (small sets; the route streams). */
export function zipDataFiles(folder, files) {
  const entries = {};
  files.forEach((file) => { entries[`${folder}/${file.path}`] = strToU8(fileText(file)); });
  return zipSync(entries, { level: 6 });
}

const ZIP_SLICE_CHARS = 512 * 1024;
const EMPTY = new Uint8Array(0);

// End of a slice of `text` from `at`, never between the two halves of a surrogate pair.
function sliceEnd(text, at) {
  let end = Math.min(text.length, at + ZIP_SLICE_CHARS);
  if (end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return end;
}

/**
 * The ZIP as a stream, made as the client reads it: one entry at a time, each
 * file's text in slices. A file's text is dropped as soon as its entry is
 * written, so the large files are never in memory together.
 * Takes over `files` (entries are removed as they are written).
 * @returns {ReadableStream<Uint8Array>}
 */
export function zipDataStream(folder, files) {
  const out = [];
  let finished = false;
  const zip = new Zip((err, chunk, final) => {
    if (err) throw err;
    out.push(chunk);
    if (final) finished = true;
  });
  let ended = false;
  let entry = null; // the ZipDeflate being written
  let pieces = null; // iterator over the current file's pieces
  let text = ''; // the piece being sliced
  let at = 0;

  const step = () => {
    if (!entry) {
      const file = files.shift();
      if (!file) {
        if (!ended) { ended = true; zip.end(); }
        return;
      }
      entry = new ZipDeflate(`${folder}/${file.path}`, { level: 6 });
      zip.add(entry);
      pieces = (typeof file.content === 'function' ? file.content() : [String(file.content ?? '')])[Symbol.iterator]();
      return;
    }
    if (at < text.length) {
      const end = sliceEnd(text, at);
      entry.push(strToU8(text.slice(at, end)));
      at = end;
      return;
    }
    const next = pieces.next();
    text = '';
    at = 0;
    if (next.done) {
      entry.push(EMPTY, true);
      entry = null;
      pieces = null;
      return;
    }
    text = String(next.value ?? '');
  };

  return new ReadableStream({
    pull(controller) {
      try {
        while (!out.length && !finished) step();
        while (out.length) controller.enqueue(out.shift());
        if (finished) controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      files.length = 0;
      entry = null;
      pieces = null;
      text = '';
    },
  });
}

function transferOrigin(request, env) {
  try {
    return new URL(request.url).origin;
  } catch {
    return String(env.APP_URL || 'https://sp-survey.org').replace(/\/$/, '');
  }
}

/**
 * survey_download_url: a signed link (15 minutes, this user and this project)
 * to GET the data ZIP.
 */
export async function createDownloadUrl(env, ctx, args = {}, request) {
  const projectId = String(args.projectId || '');
  if (!isSafeProjectId(projectId)) throw Object.assign(new Error('Invalid project id'), { status: 400, code: 'INVALID_PROJECT_ID' });
  const row = await loadOwned(env, { ...ctx, projectId });
  // A browser session (Supabase JWT) can read projects it collaborates on; the
  // link is redeemed for the owner only, so only the owner gets one.
  if (!ctx.userId || row.user_id !== ctx.userId) {
    throw Object.assign(new Error('Only the project owner can get a download link. Others can export the data on the project\'s Results page in the site.'), { status: 403, code: 'FORBIDDEN' });
  }
  const includePractice = args.includePractice === true;
  const { token, expiresAt } = await signTransferToken(env, {
    kind: 'download', userId: ctx.userId, projectId, includePractice,
  }, DOWNLOAD_TOKEN_TTL_SECONDS);
  const downloadUrl = `${transferOrigin(request, env)}${DOWNLOAD_PATH_PREFIX}${token}`;
  return {
    success: true,
    projectId,
    downloadUrl,
    method: 'GET',
    expiresAt,
    curl: `curl -L -o data.zip '${downloadUrl}'`,
    files: dataFileNames(row),
    limits: { maxRows: DOWNLOAD_MAX_ROWS, maxJsonBytes: DOWNLOAD_MAX_JSON_BYTES },
    note: 'Anyone with this link can download the data until it expires, so do not share it. Unzip and start with README.txt.',
  };
}

function tooManyRows(count) {
  const n = Number.isFinite(count) ? `${count} responses` : `more than ${DOWNLOAD_MAX_ROWS} responses`;
  return Object.assign(new Error(`This project has ${n}, more than one download can hold (${DOWNLOAD_MAX_ROWS}). ${USE_SITE_EXPORT}`), { status: 413, code: 'DOWNLOAD_TOO_LARGE' });
}

function tooManyBytes() {
  return Object.assign(new Error(`The responses are more than one download can hold (${DOWNLOAD_MAX_JSON_BYTES / 1048576} MB of data). ${USE_SITE_EXPORT}`), { status: 413, code: 'DOWNLOAD_TOO_LARGE' });
}

/**
 * GET (or HEAD) /api/mcp/download/<token> after the token is verified: the
 * owner check, the size checks, then the ZIP as a stream. HEAD stops after the
 * checks and builds nothing.
 */
export async function handleDataDownload(env, claims, { method = 'GET' } = {}) {
  const row = await loadOwned(env, { userId: claims.userId, serviceRole: true, projectId: claims.projectId });
  const folder = dataZipFolder(claims.projectId);
  const headers = {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${folder}.zip"`,
    'cache-control': 'no-store',
  };
  // A cheap count first; null when the database does not say.
  const count = await countProjectResponses(env, claims.projectId);
  if (count != null && count > DOWNLOAD_MAX_ROWS) throw tooManyRows(count);
  if (method === 'HEAD') return new Response(null, { status: 200, headers });

  let responses;
  try {
    responses = await fetchAllResponses(env, claims.projectId, { maxRows: DOWNLOAD_MAX_ROWS, maxBytes: DOWNLOAD_MAX_JSON_BYTES });
  } catch (err) {
    if (err?.code === 'TOO_MANY_RESPONSES') throw tooManyRows(null);
    if (err?.code === 'PAYLOAD_TOO_LARGE') throw tooManyBytes();
    throw err;
  }
  const files = buildDataFiles({ row, responses, includePractice: claims.includePractice });
  responses = null;
  return new Response(zipDataStream(folder, files), { status: 200, headers });
}
