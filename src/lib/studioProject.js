/**
 * Plain facts about a project for Studio: what kind of survey it is, whether
 * it is published, which image folders the page reads and what is missing
 * before it can go live. Pure and deterministic; the page words the results
 * in the researcher's language.
 */

import { SITE_MEDIA_ROOT, pageMediaFolderNames, siteMediaFolderNames } from './spSite';
import { getRecursiveMedia, inferMediaType, listAllKnownFolders, normalizeFolderPath, normalizeMediaEntry } from './mediaUtils';

/** The project's current draft config. */
export function projectConfig(project) {
  return project?._surveyConfig && typeof project._surveyConfig === 'object' ? project._surveyConfig : {};
}

export function configHasQuestions(config) {
  return (config?.pages || []).some((page) => (page?.elements || []).length > 0);
}

/**
 * 'page': a participant page built by an AI (SP-Scheme); 'classic': questions
 * built in the classic editor; 'empty': nothing yet.
 */
export function projectKind(projectOrConfig) {
  const config = projectOrConfig?._surveyConfig !== undefined ? projectConfig(projectOrConfig) : (projectOrConfig || {});
  if (config?.spSite?.html) return 'page';
  if (configHasQuestions(config)) return 'classic';
  return 'empty';
}

function stamp(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : null;
}

/**
 * 'draft': never published; 'published': participants see the latest draft;
 * 'pending': published, but the draft changed since.
 * @returns {{ state: 'draft'|'published'|'pending', version: number }}
 */
export function projectStatus(project) {
  const version = Number(project?.publishedVersion) || 0;
  if (!project?.releaseManaged || !version) return { state: 'draft', version: 0 };
  const draft = stamp(project.draftUpdatedAt);
  const published = stamp(project.publishedAt);
  if (draft !== null && published !== null && draft > published) return { state: 'pending', version };
  return { state: 'published', version };
}

/** Newest first by last change (projects without a date go last). */
export function sortProjectsNewestFirst(projects = []) {
  const time = (p) => stamp(p?.lastModified) ?? stamp(p?.draftUpdatedAt) ?? stamp(p?.createdAt) ?? 0;
  return [...(Array.isArray(projects) ? projects : [])].filter((p) => p?.id).sort((a, b) => time(b) - time(a));
}

function projectPrefix(project) {
  return project?.userId && project?.id ? `${project.userId}/${project.id}/` : null;
}

/** Folders the participant page reads its images from (the library root is left out). */
export function pageFolders(config) {
  if (!config?.spSite?.html) return [];
  const names = new Set();
  [...siteMediaFolderNames(config), ...pageMediaFolderNames(config.spSite.html)].forEach((name) => {
    if (name === SITE_MEDIA_ROOT) return;
    const folder = normalizeFolderPath(name);
    if (folder) names.add(folder);
  });
  return [...names];
}

/** Files in a folder of the project library, subfolders included. */
export function folderFileCount(project, folder) {
  return getRecursiveMedia(project?.preloadedImages || [], folder, projectPrefix(project)).length;
}

/**
 * The image library by folder, with file counts.
 * @returns {{ folder: string, count: number }[]}
 */
export function libraryFolders(project) {
  const pool = project?.preloadedImages || [];
  const settings = project?.imageDatasetConfig || {};
  const prefix = projectPrefix(project);
  return listAllKnownFolders(pool, settings.mediaFolderTags, prefix, settings.mediaFolders)
    .map((folder) => ({ folder, count: getRecursiveMedia(pool, folder, prefix).length }));
}

/** Library files that sit in no folder. */
export function looseFileCount(project) {
  const prefix = projectPrefix(project);
  return (project?.preloadedImages || []).filter((raw) => {
    const entry = normalizeMediaEntry(raw, prefix);
    return entry?.url && !entry.folder;
  }).length;
}

/** Up to `max` images to show as a strip of thumbnails. */
export function libraryThumbnails(project, max = 4) {
  const prefix = projectPrefix(project);
  const out = [];
  for (const raw of project?.preloadedImages || []) {
    const entry = normalizeMediaEntry(raw, prefix);
    if (entry?.url && /^https?:|^\//i.test(entry.url) && (entry.type || inferMediaType(entry.name)) === 'image') out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

/** Folders the page reads that hold no files yet. */
export function missingPageFolders(project, config = projectConfig(project)) {
  return pageFolders(config).filter((folder) => folderFileCount(project, folder) === 0);
}

/**
 * A folder name a researcher typed, made safe for the library: letters,
 * digits, `_` and `-` in each part, parts joined by `/`; no `.` or `..` parts.
 */
export function cleanFolderName(raw) {
  return normalizeFolderPath(raw)
    .split('/')
    .map((part) => part.normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, ''))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .slice(0, 120);
}

/** The folder new uploads go to by default: the first one the page reads, else "images". */
export function defaultUploadFolder(config) {
  return pageFolders(config)[0] || 'images';
}

/**
 * A new project's name after an import: the page's title, else the file name
 * without its extension, else the fallback. Generic file names do not count.
 */
export function importedProjectName({ title = '', name = '' } = {}, fallback = 'New study') {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const fromTitle = clean(title);
  if (fromTitle) return fromTitle;
  const file = clean(String(name || '').split(/[\\/]/).pop().replace(/\s\+\s\d+$/, '').replace(/\.(html?|zip)$/i, ''));
  if (file && !/^(index|page|survey|study|files?|\d+ files)$/i.test(file)) return file;
  return fallback;
}

/**
 * The page text for an AI to edit: SP-Scheme first, then the current page.
 */
export function pageForAiText(schemeText, html) {
  return `${schemeText}\n\n## My current index.html\nEdit this page and hand it back as index.html, or as a zip with its images.\n\n\`\`\`html\n${String(html || '')}\n\`\`\`\n`;
}
