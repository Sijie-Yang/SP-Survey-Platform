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
 */

import { strToU8, zipSync } from 'fflate';
import { recordedSurveyConfig } from '../../src/lib/recordedSurvey.js';
import { buildResponsesWideCsv } from '../../src/lib/responsesWideExport.js';
import { buildSiteResultsExportFiles } from '../../src/lib/questionSummaryExport.js';
import { howToCiteLines, platformBibtex, resultsCitationCff } from '../../src/lib/platformCitation.js';
import { exportDateStamp, rowsToCsv } from '../../src/lib/csvUtil.js';
import { inferMediaType } from '../../src/lib/mediaUtils.js';
import { isSafeProjectId, sanitizeForAgent } from '../designProtocol.mjs';
import { loadOwned } from './projectLifecycle.mjs';
import { fetchAllResponses } from './resultsHandlers.mjs';
import {
  DOWNLOAD_PATH_PREFIX,
  DOWNLOAD_TOKEN_TTL_SECONDS,
  signTransferToken,
} from '../mcp/transferTokens.mjs';

export const DOWNLOAD_MAX_ROWS = 20000;

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
 * The ZIP's files (paths relative to its folder). Pure, so tests can check it.
 * @param {{ row: object, responses: object[], includePractice?: boolean }} args
 * @returns {{ path: string, content: string }[]}
 */
export function buildDataFiles({ row, responses, includePractice = false }) {
  const config = participantConfig(row);
  const practice = includePractice === true || config?.includeResearcherPractice === true;
  const rows = downloadRows(responses, config, includePractice);
  const recorded = recordedSurveyConfig(rows, config || {});
  const questions = (recorded?.pages || []).flatMap((page) => page?.elements || []);
  const wideCsv = buildResponsesWideCsv(rows, questions, recorded);
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
    const files = buildSiteResultsExportFiles({ project, filteredResponses: rows, wideCsv });
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
    { path: 'responses_raw.json', content: `${JSON.stringify(rows, null, 2)}\n` },
    ...extras,
    { path: 'references.bib', content: platformBibtex() },
    { path: 'CITATION.cff', content: resultsCitationCff({ project, releaseDate: exportDateStamp() }) },
  ];
}

export function dataZipFolder(projectId) {
  return `results_${projectId || 'survey'}_${exportDateStamp()}`;
}

/** The ZIP bytes for the files, inside one folder. */
export function zipDataFiles(folder, files) {
  const entries = {};
  files.forEach((file) => { entries[`${folder}/${file.path}`] = strToU8(String(file.content ?? '')); });
  return zipSync(entries, { level: 6 });
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
    note: 'The link works once you run the curl line; anyone with it can download this data until it expires, so do not share it. Unzip and start with README.txt.',
  };
}

/** GET /api/mcp/download/<token> after the token is verified: the owner check, then the ZIP. */
export async function handleDataDownload(env, claims) {
  const row = await loadOwned(env, { userId: claims.userId, serviceRole: true, projectId: claims.projectId });
  const responses = await fetchAllResponses(env, claims.projectId);
  if (responses.length > DOWNLOAD_MAX_ROWS) {
    throw Object.assign(new Error(`Too many responses (${responses.length}) for one download (max ${DOWNLOAD_MAX_ROWS}). Use survey_export_responses with date filters.`), { status: 413, code: 'DOWNLOAD_TOO_LARGE' });
  }
  const files = buildDataFiles({ row, responses, includePractice: claims.includePractice });
  const folder = dataZipFolder(claims.projectId);
  const bytes = zipDataFiles(folder, files);
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${folder}.zip"`,
      'cache-control': 'no-store',
    },
  });
}
