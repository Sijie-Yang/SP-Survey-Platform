/**
 * "Download" on a template row: one ZIP with the template itself and its
 * media library, so a template can be kept, cited or reused as a dataset.
 *
 *   README.md      what the package is, the paper to cite, what each file is
 *   template.json  name, paper, survey config and media-folder settings
 *   index.html     the SP-Scheme page (only for SP-Scheme templates)
 *   media/...      every file of the media library, in its own folders
 *   media.csv      one row per media file: path, folder, bytes, original URL
 *
 * Media files are the exact bytes the platform serves (no re-encoding here).
 */
import { buildZipBlob } from './zipDownload';
import { fetchPublishedTemplate } from './publishedTemplate';
import { listImagesFromR2 } from './r2';
import { fetchUrlBytes } from './mediaLibraryDownload';
import { mediaRelativePathFromListing } from './mediaUtils';
import { stripOwnResponseSupabase } from './ownResponseSupabase';

const FETCH_CONCURRENCY = 6;

export function templateMediaPrefix(templateId) {
  return `templates/${templateId}/`;
}

/** Media files of the template's library (feature CSVs and annotations left out). */
export function templateMediaFiles(listing, templateId) {
  const prefix = templateMediaPrefix(templateId);
  const used = new Set();
  return (listing || [])
    .filter((img) => {
      const key = String(img?.key || '');
      return img?.url && !key.includes('/features/') && !key.includes('/preannotations/');
    })
    .map((img) => {
      const rel = mediaRelativePathFromListing(img, prefix) || img.name || 'file';
      let path = `media/${rel}`;
      for (let n = 2; used.has(path); n += 1) {
        const dot = rel.lastIndexOf('.');
        path = dot > rel.lastIndexOf('/') ? `media/${rel.slice(0, dot)}__${n}${rel.slice(dot)}` : `media/${rel}__${n}`;
      }
      used.add(path);
      const slash = rel.lastIndexOf('/');
      return {
        path,
        folder: slash >= 0 ? rel.slice(0, slash) : '',
        bytes: Number(img.size) || 0,
        url: img.url,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function totalBytes(files) {
  return (files || []).reduce((sum, f) => sum + (Number(f.bytes) || 0), 0);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function mediaCsv(files) {
  const rows = [['path', 'folder', 'bytes', 'url'], ...(files || []).map((f) => [f.path, f.folder, f.bytes, f.url])];
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}

export function paperCitation(paper, template = {}) {
  if (!paper) return '';
  const doi = paper.doi ? `https://doi.org/${paper.doi}` : (paper.paper_url || template.website || '');
  return [
    paper.authors,
    paper.year ? `(${paper.year})` : '',
    paper.title ? `${String(paper.title).replace(/\.$/, '')}.` : '',
    paper.venue ? `${paper.venue}.` : '',
    doi,
  ].filter(Boolean).join(' ');
}

export function templateReadme({ template, title, paper, files, hasPage, failed = [] }) {
  const lines = [
    `# ${title || template.name || template.id}`,
    '',
    `SP-Survey template \`${template.id}\`, downloaded from https://sp-survey.org/templates on ${new Date().toISOString().slice(0, 10)}.`,
    '',
  ];
  const cite = paperCitation(paper, template);
  if (cite) lines.push('## Paper', '', cite, '');
  else if (template.website) lines.push('## Paper', '', template.website, '');
  lines.push(
    '## Files',
    '',
    '- `template.json`: template details, survey config and media-folder settings.',
    ...(hasPage ? ['- `index.html`: the SP-Scheme survey page.'] : []),
    `- \`media/\`: the template's media library, ${files.length} files (${formatBytes(totalBytes(files))}), in their original folders.`,
    '- `media.csv`: one row per media file (path, folder, size in bytes, URL on sp-survey.org).',
    '',
    'Media files are exactly the files the platform shows to participants.',
    'Use them under the licence of the original paper or dataset; cite the paper above.',
    '',
  );
  if (failed.length) {
    lines.push(`## Missing files`, '', `${failed.length} file(s) could not be downloaded and are not in this ZIP:`, '', ...failed.map((f) => `- ${f.path}`), '');
  }
  return lines.join('\n');
}

/** template.json: everything needed to rebuild the template, page html kept in index.html. */
export function templateJson({ template, published, paper }) {
  const config = stripOwnResponseSupabase(published?.config || {}) || {};
  const page = config?.spSite?.html ? { ...config, spSite: { ...config.spSite, html: '(see index.html)' } } : config;
  return {
    id: template.id,
    name: published?.name || template.name || '',
    description: published?.description || template.description || '',
    author: published?.author || template.author || '',
    year: published?.year || template.year || '',
    category: published?.category || template.category || '',
    tags: template.tags || [],
    paper: paper ? {
      title: paper.title || '', authors: paper.authors || '', year: paper.year || '',
      venue: paper.venue || '', doi: paper.doi || '', url: paper.paper_url || '',
    } : null,
    paperUrl: published?.website || template.paper_url || null,
    huggingfaceDataset: published?.huggingfaceDataset || template.dataset || null,
    surveyConfig: page,
    imageDatasetConfig: published?.imageDatasetConfig || {},
  };
}

export function packageFileName(templateId) {
  return `sp-survey-template_${String(templateId).replace(/[^a-zA-Z0-9._-]+/g, '_')}.zip`;
}

/** Step 1: what the ZIP will hold (fast, no media bytes yet). */
export async function prepareTemplatePackage(template) {
  const [published, listed] = await Promise.all([
    fetchPublishedTemplate(template.id),
    listImagesFromR2(templateMediaPrefix(template.id)),
  ]);
  if (!listed.success) throw new Error(listed.error || 'Could not list the media library.');
  const files = templateMediaFiles(listed.images, template.id);
  return { published, files, bytes: totalBytes(files), hasPage: Boolean(published?.config?.spSite?.html) };
}

/** Step 2: fetch every media file, build the ZIP blob. */
export async function buildTemplatePackage({ template, title, prepared, onProgress, signal }) {
  const { published, files, hasPage } = prepared;
  const out = new Array(files.length);
  const failed = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = next;
      next += 1;
      try {
        out[i] = { path: files[i].path, content: await fetchUrlBytes(files[i].url) };
      } catch {
        failed.push(files[i]);
      }
      done += 1;
      onProgress?.(done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, files.length) }, worker));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const paper = template.paper || null;
  const entries = [
    { path: 'README.md', content: templateReadme({ template, title, paper, files, hasPage, failed }) },
    { path: 'template.json', content: `${JSON.stringify(templateJson({ template, published, paper }), null, 2)}\n` },
    ...(hasPage ? [{ path: 'index.html', content: published.config.spSite.html }] : []),
    { path: 'media.csv', content: mediaCsv(files) },
    ...out.filter(Boolean),
  ];
  return { blob: buildZipBlob(entries), failed, filename: packageFileName(template.id) };
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
