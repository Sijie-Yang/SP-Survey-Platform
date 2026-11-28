/**
 * The study's media library, told to the AI that writes the SP-Scheme page,
 * and a check of a page against it.
 *
 * The model reads the list (folders, file counts, file names) and fits the
 * page to it; whether the page then asks for a folder or a file the library
 * does not hold is decided here, by plain comparison, not by the model.
 *
 * Pure (no DOM, no Supabase): the Worker imports it too.
 */

import { normalizeMediaEntry } from './mediaUtils.js';
import { extractEmbeddedScheme, flatElements, pageReferencedFiles, siteMediaName } from './spSiteCore.js';

export const BRIEF_NAMES_PER_FOLDER = 60;
export const BRIEF_MAX_NAMES = 400;
export const BRIEF_MAX_FOLDERS = 40;
const GAP_NAMES_SHOWN = 12;

const cleanFolder = (value) => String(value || '').trim().replace(/^\/+|\/+$/g, '');
const byNaturalOrder = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** Every library file as { folder, name, type }, with the name a page knows it by. */
export function mediaLibraryFiles(pool, projectPrefix = null) {
  return (Array.isArray(pool) ? pool : [])
    .map((item) => normalizeMediaEntry(item, projectPrefix))
    .filter((entry) => entry?.url)
    .map((entry) => ({
      folder: cleanFolder(entry.folder),
      name: siteMediaName(entry.name || String(entry.url).split('?')[0].split('/').pop()),
      type: /video/i.test(entry.type) ? 'video' : /audio/i.test(entry.type) ? 'audio' : 'image',
    }));
}

/**
 * The library by folder: `{ total, folders: [{ folder, count, types, names, more }] }`.
 * Folder '' is the library root. Long folders list their first names only
 * (`more` counts the rest), so a library of thousands stays a short text.
 */
export function mediaLibraryBrief(pool, projectPrefix = null) {
  const files = mediaLibraryFiles(pool, projectPrefix);
  const groups = new Map();
  files.forEach((file) => {
    if (!groups.has(file.folder)) groups.set(file.folder, []);
    groups.get(file.folder).push(file);
  });
  let budget = BRIEF_MAX_NAMES;
  const folders = [...groups.keys()].sort(byNaturalOrder).map((folder) => {
    const list = groups.get(folder);
    const types = {};
    list.forEach((file) => { types[file.type] = (types[file.type] || 0) + 1; });
    const shown = Math.max(0, Math.min(list.length, BRIEF_NAMES_PER_FOLDER, budget));
    budget -= shown;
    const names = list.map((file) => file.name).sort(byNaturalOrder).slice(0, shown);
    return { folder, count: list.length, types, names, more: list.length - names.length };
  });
  return { total: files.length, folders };
}

function typeWords(types) {
  return Object.entries(types)
    .map(([type, n]) => `${n} ${type === 'audio' ? 'audio file' : type}${n === 1 ? '' : 's'}`)
    .join(', ');
}

/** The library as the text the page-writing model reads. */
export function mediaLibraryText(brief) {
  if (!brief?.total) {
    return 'The study\'s media library is empty: declare the media folders the page needs; the researcher uploads the files afterwards.';
  }
  const shownFolders = brief.folders.slice(0, BRIEF_MAX_FOLDERS);
  const lines = shownFolders.map(({ folder, count, types, names, more }) => {
    const where = folder ? `folder "${folder}"` : 'library root (no folder)';
    const listed = names.length ? `: ${names.join(', ')}${more ? `, … and ${more} more` : ''}` : '';
    return `- ${where}, ${typeWords(types) || `${count} files`}${listed}`;
  });
  if (brief.folders.length > shownFolders.length) lines.push(`- … and ${brief.folders.length - shownFolders.length} more folders`);
  return [
    `The study's media library holds ${brief.total} file(s) right now:`,
    ...lines,
    '',
    'Fit the page to this library:',
    '- Read media only from these folders (the survey\'s "mediaFolders" and SPSite.getMedia use these names). Add another folder only when the researcher asks for one.',
    '- When the page needs particular files (fixed pairs, conditions, a set order), use exactly the file names listed. When any picture will do, draw from the folder and do not check for particular file names.',
    '- When the roles of the files cannot be told from their names (which picture is the left one, which condition a picture belongs to), do not guess: say in your note what the researcher should tell you or how to name the files.',
    '- Never ask for more files than a folder holds: set the number of trials and images per trial to what the library allows.',
    '- Where a list above is cut short, do not rely on the names that are not shown.',
  ].join('\n');
}

/** Media folders a page reads: declared in its survey JSON or named in SPSite.getMedia('…'). */
export function pageWantedFolders(html) {
  const names = new Set();
  const scheme = extractEmbeddedScheme(html);
  const survey = scheme && !scheme.__invalid ? (scheme.survey || scheme) : null;
  const add = (value) => {
    const folder = cleanFolder(value);
    if (folder) names.add(folder);
  };
  if (survey) {
    (Array.isArray(survey.mediaFolders) ? survey.mediaFolders : []).forEach(add);
    flatElements(survey.pages).forEach(({ element }) => (Array.isArray(element.mediaFolders) ? element.mediaFolders : []).forEach(add));
  }
  const re = /SPSite\s*\.\s*getMedia\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g;
  let m;
  while ((m = re.exec(String(html || '')))) add(m[2]);
  return [...names];
}

/**
 * What the page asks for that the library does not hold: folders it reads and
 * files it names. Empty for an empty library (nothing is uploaded yet) and
 * for a page that fits. `[{ path: 'media library', kind: 'folders' | 'files', items, message }]`;
 * `message` is written for the page-writing model.
 */
export function pageMediaGaps(html, pool, projectPrefix = null) {
  const files = mediaLibraryFiles(pool, projectPrefix);
  if (!files.length) return [];
  const gaps = [];
  const folders = [...new Set(files.map((file) => file.folder))];
  const named = folders.filter(Boolean).sort(byNaturalOrder);
  const hasFolder = (wanted) => folders.some((f) => f === wanted || f.startsWith(`${wanted}/`) || f.endsWith(`/${wanted}`));
  const missingFolders = pageWantedFolders(html).filter((folder) => !hasFolder(folder));
  if (missingFolders.length) {
    gaps.push({
      path: 'media library',
      kind: 'folders',
      items: missingFolders,
      message: `The page reads the media folder${missingFolders.length > 1 ? 's' : ''} ${missingFolders.map((f) => `"${f}"`).join(', ')}, which the study's media library does not have. `
        + (named.length ? `Its folders are: ${named.map((f) => `"${f}"`).join(', ')}.` : 'Its files are in the library root, not in a folder.'),
    });
  }
  const paths = new Set(files.map((file) => `${file.folder ? `${file.folder}/` : ''}${file.name}`.toLowerCase()));
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  const missingFiles = [];
  const text = String(html || '');
  const lower = text.toLowerCase();
  pageReferencedFiles(html).forEach((name, path) => {
    if (paths.has(path) || names.has(name)) return;
    // pageReferencedFiles lower-cases; show the name as the page writes it.
    const at = lower.indexOf(path);
    missingFiles.push(at >= 0 ? text.slice(at, at + path.length) : path);
  });
  if (missingFiles.length) {
    const shown = missingFiles.slice(0, GAP_NAMES_SHOWN).join(', ');
    gaps.push({
      path: 'media library',
      kind: 'files',
      items: missingFiles,
      message: `The page names ${missingFiles.length} file(s) that are not in the study's media library: ${shown}${missingFiles.length > GAP_NAMES_SHOWN ? ', …' : ''}. Use the library's own file names, or draw from the folder without naming files.`,
    });
  }
  return gaps;
}
