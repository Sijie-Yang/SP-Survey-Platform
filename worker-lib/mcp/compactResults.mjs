/**
 * Keeps MCP replies small enough for a model to read. An agent reads every
 * reply in full, and most clients cut or refuse anything past a few tens of
 * KB, so long lists are paged, long texts shortened, media URLs given as file
 * names and big file bodies handed over as a download link instead.
 * Every compact reply says how to get the full one (`verbose: true` or
 * `inline: true`).
 */

/** Largest reply (JSON characters) sent as it is. */
export const MCP_INLINE_CHARS = 60000;

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const pageArgs = (args, { limit = 30, max = 200 } = {}) => ({
  limit: Math.min(max, Math.max(1, Math.floor(Number(args.limit) || limit))),
  offset: Math.max(0, Math.floor(Number(args.offset) || 0)),
});

const matches = (query, ...fields) => {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fields.flat().map((f) => String(f ?? '')).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
};

/** survey_list_templates: one short line per template, searchable and paged. */
export function compactTemplateList(result, args = {}) {
  if (args.verbose === true || !Array.isArray(result?.templates)) return result;
  const { limit, offset } = pageArgs(args);
  const found = result.templates.filter((t) => matches(args.query, t.id, t.name, t.author, t.year, t.category, t.tags, t.description));
  return {
    success: true,
    total: found.length,
    offset,
    limit,
    templates: found.slice(offset, offset + limit).map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.author ? { author: clip(t.author, 80) } : {}),
      ...(t.year ? { year: t.year } : {}),
      ...(Array.isArray(t.tags) && t.tags.length ? { tags: t.tags.slice(0, 8) } : {}),
      ...(t.isApproved === false ? { pending: true } : {}),
      summary: clip(t.description, 160),
    })),
    ...(offset + limit < found.length ? { next: `More: call again with offset ${offset + limit}.` } : {}),
    note: 'query searches name, author, year, tags and description. survey_get_template gives one template in full; verbose:true lists every field of every template.',
  };
}

/** survey_list_projects: newest first, one short line per project, searchable and paged. */
export function compactProjectList(result, args = {}) {
  if (args.verbose === true || !Array.isArray(result?.projects)) return result;
  const { limit, offset } = pageArgs(args, { limit: 50 });
  const stamp = (p) => String(p.updatedAt || p.lastModified || p.draftUpdatedAt || '');
  const found = result.projects
    .filter((p) => matches(args.query, p.id, p.name, p.templateId, p.description))
    .sort((a, b) => stamp(b).localeCompare(stamp(a)));
  return {
    success: true,
    total: found.length,
    offset,
    limit,
    projects: found.slice(offset, offset + limit).map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: stamp(p) || null,
      ...(p.publishedVersion != null ? { publishedVersion: p.publishedVersion } : {}),
      ...(p.templateId ? { templateId: p.templateId } : {}),
    })),
    ...(offset + limit < found.length ? { next: `More: call again with offset ${offset + limit}.` } : {}),
    note: 'Newest first. query searches name and id; verbose:true lists every field.',
  };
}

/** credentials_status: what is configured, without the provider catalog. */
export function compactCredentialStatus(result, args = {}) {
  if (args.verbose === true || !result || typeof result !== 'object') return result;
  const { catalog, directory, providers, ...rest } = result;
  return {
    ...rest,
    note: 'verbose:true adds the full provider and model catalog.',
  };
}

// A media URL as its file name ("street_15__f191.jpg"); other values as they are.
function mediaName(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return value;
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').pop() || value);
  } catch {
    return value;
  }
}

const round = (value) => (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
  ? Number(value.toPrecision(4))
  : value);

function compactRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out = {};
  Object.entries(row).forEach(([key, value]) => {
    if (['question_name', 'question_type', 'n_responses'].includes(key)) return; // the same on every row
    if (value === '' || value == null) return;
    out[key] = round(mediaName(value));
  });
  if (out.unit_key && out.unit_key === out.unit_label) delete out.unit_label;
  return out;
}

function compactQuestionDetail(question, limit) {
  if (!question || typeof question !== 'object') return question;
  const out = { ...question };
  if (Array.isArray(question.metrics)) {
    out.metricsTotal = question.metrics.length;
    out.metrics = question.metrics.slice(0, limit).map(compactRow);
  }
  if (question.comparison && Array.isArray(question.comparison.rankings)) {
    out.comparison = {
      ...question.comparison,
      rankings: question.comparison.rankings.slice(0, limit).map(compactRow),
    };
  }
  return out;
}

/**
 * survey_results_summary: media as file names, numbers to 4 significant
 * digits, at most `limit` metric rows (default 200), the method catalogue only
 * on request, and the question list without the selected question's rows.
 */
export function compactResultsSummary(result, args = {}) {
  if (args.verbose === true || !result || typeof result !== 'object') return result;
  const limit = Math.min(2000, Math.max(1, Math.floor(Number(args.limit) || 200)));
  const { availableMethods, ...rest } = result;
  const out = { ...rest };
  if (out.question) out.question = compactQuestionDetail(out.question, limit);
  if (Array.isArray(out.questions)) {
    // The selected question's rows are already under `question`.
    out.questions = out.questions.map(({ summary_rows: rows, metrics, comparison, ...item }) => item);
  }
  if (out.question?.metricsTotal > limit) {
    out.note = `${out.note ? `${out.note} ` : ''}Showing the first ${limit} of ${out.question.metricsTotal} metric rows; pass limit for more, or use survey_download_url for every row.`;
  }
  out.compact = 'Media are shown by file name and numbers to 4 significant digits; verbose:true gives the full reply (with availableMethods).';
  return out;
}

const BODY_KEYS = ['responses', 'wideCsv', 'longCsv', 'longCsvFiles', 'summaryCsv', 'summaryCsvFiles', 'analysisBundle', 'datasetPackage'];

/**
 * survey_export_responses: when the files would not fit in a reply, the reply
 * lists them (path and size) and gives a download link for the same export.
 * @param {object} result exportResponses result
 * @param {object[]} files exportResultFiles(result)
 * @param {object|null} link createDownloadUrl result, or { error }
 */
export function compactExport(result, files, link) {
  const out = {};
  Object.entries(result).forEach(([key, value]) => { if (!BODY_KEYS.includes(key)) out[key] = value; });
  if (result.analysisBundle?.manifest) out.manifest = result.analysisBundle.manifest;
  const bytes = files.reduce((sum, f) => sum + f.content.length, 0);
  out.files = files.map((f) => ({ path: f.path, chars: f.content.length }));
  out.download = link?.downloadUrl
    ? { downloadUrl: link.downloadUrl, expiresAt: link.expiresAt, curl: link.curl }
    : { error: link?.error || 'No download link.' };
  out.note = link?.downloadUrl
    ? `These ${files.length} file(s) (${Math.round(bytes / 1024)} KB) are too large for a reply, so they are not included: download them with the curl line (the link works for 15 minutes; do not share it) and read README first if there is one. Pass inline:true to get them in the reply anyway, or questionName for one question.`
    : `These ${files.length} file(s) (${Math.round(bytes / 1024)} KB) are too large for a reply. Pass questionName for one question, or inline:true to get them anyway.`;
  return out;
}
