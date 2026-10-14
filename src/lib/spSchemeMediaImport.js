/**
 * Upload the stimulus files that came in a converted project zip to the
 * project's media library, in the folders the conversion planned, so the
 * survey's questions can draw them like any other project media.
 */

import { uploadMediaBatch } from './mediaUploadBatch';
import { inferMediaType } from './mediaUtils';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg' };

function newId() {
  return typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toFile({ path, bytes }) {
  const name = path.split('/').pop();
  const ext = name.split('.').pop().toLowerCase();
  return new File([bytes], name, { type: MIME[ext] || (inferMediaType(name) === 'image' ? 'image/*' : 'application/octet-stream') });
}

/**
 * @param {{ plan: { files: { path, bytes, folder }[] }, project: object, userId: string,
 *   upload: (file: File, key: string) => Promise<{ success, url, error }>,
 *   onProjectUpdate: (project: object, opts: object) => Promise<void>, onProgress?: Function }} args
 */
export async function uploadPlannedMedia({ plan, project, userId, upload, onProjectUpdate, onProgress = () => {} }) {
  if (!project?.id || !userId) throw new Error('Open a project before importing its media.');
  const byFolder = new Map();
  plan.files.forEach((file) => {
    if (!byFolder.has(file.folder)) byFolder.set(file.folder, []);
    byFolder.get(file.folder).push(file);
  });
  const total = plan.files.length;
  const uploadFolder = async (folder, files, base, offset) => {
    let saved = base;
    const result = await uploadMediaBatch({
      files: files.map(toFile),
      prefix: `${userId}/${project.id}/`,
      folder,
      prepare: (raw) => raw,
      upload,
      makeId: newId,
      onProgress: ({ processed }) => onProgress({ done: offset + processed, total }),
      persist: async (batch) => {
        saved = {
          ...base,
          preloadedImages: [...(base.preloadedImages || []), ...batch],
          preloadedAt: new Date().toISOString(),
          preloadedSource: 'r2',
        };
        await onProjectUpdate(saved, { throwOnError: true });
      },
    });
    return { result, saved };
  };
  let done = 0;
  let latest = project;
  const uploaded = [];
  const failures = [];
  for (const [folder, files] of byFolder) {
    // Folders go one after another so each save includes the folders before it.
    // eslint-disable-next-line no-await-in-loop
    const { result, saved } = await uploadFolder(folder, files, latest, done);
    latest = saved;
    done += files.length;
    uploaded.push(...result.uploaded);
    failures.push(...result.failures.map((f) => ({ name: `${folder}/${f.name}`, error: f.error })));
    if (result.saveError) return { uploaded, failures, saveError: result.saveError, project: latest };
  }
  return { uploaded, failures, saveError: null, project: latest };
}

const MAX_PAGE_MEDIA = 400;

function blobBytes(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
const MAX_PAGE_MEDIA_BYTES = 300 * 1024 * 1024;

/**
 * Download the stimuli of a page imported from the web, so they can go into
 * the media library like the files of a project zip. Tries the site directly
 * (most static hosts allow it), then the platform server.
 * @returns {Promise<{ files: { path, bytes, size }[], failed: string[] }>}
 */
export async function downloadPageMedia(urls, pageUrl, { fetchViaServer, onProgress = () => {}, fetchImpl = fetch } = {}) {
  const seen = new Set();
  const list = [];
  (urls || []).forEach((raw) => {
    try {
      const url = new URL(raw, pageUrl);
      if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) return;
      seen.add(url.href);
      list.push(url);
    } catch { /* not a URL */ }
  });
  const files = [];
  const failed = [];
  const paths = new Set();
  let total = 0;
  let done = 0;
  const take = list.slice(0, MAX_PAGE_MEDIA);
  failed.push(...list.slice(MAX_PAGE_MEDIA).map((u) => u.href));
  const one = async (url) => {
    let blob = null;
    try {
      const res = await fetchImpl(url.href, { mode: 'cors' });
      if (res.ok && /^(image|video|audio)\//.test(res.headers.get('content-type') || '')) blob = await res.blob();
    } catch { /* blocked by CORS: use the server */ }
    if (!blob && fetchViaServer) {
      try { blob = await fetchViaServer(url.href, pageUrl); } catch { blob = null; }
    }
    if (!blob || total + blob.size > MAX_PAGE_MEDIA_BYTES) {
      failed.push(url.href);
      return;
    }
    total += blob.size;
    let path = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'file';
    if (!/\.[a-z0-9]{2,5}$/i.test(path)) path += `.${(blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/\W.*$/, '')}`;
    while (paths.has(path)) path = path.replace(/(\.[^.]+)$/, '_1$1');
    paths.add(path);
    files.push({ path, bytes: await blobBytes(blob), size: blob.size });
  };
  for (let i = 0; i < take.length; i += 4) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(take.slice(i, i + 4).map(one));
    done = Math.min(take.length, i + 4);
    onProgress(done);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, failed };
}
