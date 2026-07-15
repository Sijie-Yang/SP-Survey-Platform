/**
 * Client helpers for public "Request a Template for Your Paper".
 */

import { isR2Configured, uploadImageToR2, getR2ServerUrl } from './r2';
import { templateImagePrefix } from './templateManager';

export const MAX_DATASET_IMAGES = 1000;
export const MAX_SUPPLEMENTARY_FILES = 20;
/** Soft per-file cap (Express JSON body is 100mb; base64 expands ~33%). */
export const MAX_SUPPLEMENTARY_BYTES = 40 * 1024 * 1024;

const SERVER_URL = getR2ServerUrl();

export const SUPPLEMENTARY_ACCEPT =
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.zip,.rar,.7z,.md,.json';

/** Compress image in-browser to ~≤300KB (same approach as ImageDataset). */
export function compressImage(file, maxBytes = 300 * 1024, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file?.type?.startsWith('image/')) { resolve(file); return; }
    if (file.size <= maxBytes) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      const maxDim = 1920;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const tryQuality = (q) => {
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= maxBytes || q <= 0.3) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          } else {
            tryQuality(Math.max(q - 0.1, 0.3));
          }
        }, 'image/jpeg', q);
      };
      tryQuality(quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function api(method, body) {
  const res = await fetch(`${SERVER_URL}/api/template-request`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Upload survey dataset images to R2 under templates/{id}/dataset/.
 */
export async function uploadDatasetImages(templateId, files, onProgress) {
  if (!files?.length) return [];
  if (!isR2Configured()) {
    throw new Error('Image storage is not configured (REACT_APP_R2_PUBLIC_URL).');
  }
  const prefix = `${templateImagePrefix(templateId)}dataset/`;
  const uploaded = [];
  const list = Array.from(files).slice(0, MAX_DATASET_IMAGES);
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    onProgress?.({ current: i + 1, total: list.length, name: raw.name });
    const file = await compressImage(raw);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}${Date.now()}_${i}_${safeName}`;
    const result = await uploadImageToR2(file, key);
    if (!result.success) {
      throw new Error(result.error || `Failed to upload ${raw.name}`);
    }
    uploaded.push({
      url: result.url,
      name: raw.name,
      key: result.key || key,
      type: 'image',
      media_id: result.key || key,
      folder: 'dataset',
    });
  }
  return uploaded;
}

/**
 * Upload supplementary docs (PDF, etc.) to R2 under templates/{id}/supplementary/.
 */
export async function uploadSupplementaryFiles(templateId, files, onProgress) {
  if (!files?.length) return [];
  if (!isR2Configured()) {
    throw new Error('File storage is not configured (REACT_APP_R2_PUBLIC_URL).');
  }
  const prefix = `${templateImagePrefix(templateId)}supplementary/`;
  const uploaded = [];
  const list = Array.from(files).slice(0, MAX_SUPPLEMENTARY_FILES);
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (file.size > MAX_SUPPLEMENTARY_BYTES) {
      throw new Error(`"${file.name}" is too large (max ${Math.round(MAX_SUPPLEMENTARY_BYTES / (1024 * 1024))} MB).`);
    }
    onProgress?.({ current: i + 1, total: list.length, name: file.name });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}${Date.now()}_${i}_${safeName}`;
    const result = await uploadImageToR2(file, key);
    if (!result.success) {
      throw new Error(result.error || `Failed to upload ${file.name}`);
    }
    uploaded.push({
      url: result.url,
      name: file.name,
      key: result.key || key,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    });
  }
  return uploaded;
}

/**
 * Full guest submit flow:
 * 1) create pending template (get id)
 * 2) upload dataset images + supplementary files to R2
 * 3) attach metadata to the template row
 */
export async function submitPaperTemplateRequest({
  name,
  author,
  year,
  paperUrl,
  notes,
  email,
  files,
  supplementaryFiles,
  onProgress,
}) {
  onProgress?.({ phase: 'create', message: 'Creating template request…' });
  const created = await api('POST', {
    name,
    author,
    year,
    paperUrl,
    notes,
    email,
    images: [],
    supplementaryFiles: [],
  });

  const templateId = created.templateId;
  const editKey = created.editKey;
  let imageCount = 0;
  let supplementaryCount = 0;

  let images = [];
  let supplements = [];

  if (files?.length) {
    onProgress?.({ phase: 'upload', message: 'Uploading survey dataset images…', current: 0, total: files.length });
    images = await uploadDatasetImages(templateId, files, (p) => {
      onProgress?.({ phase: 'upload', message: `Uploading ${p.name}…`, current: p.current, total: p.total });
    });
  }

  if (supplementaryFiles?.length) {
    onProgress?.({
      phase: 'upload',
      message: 'Uploading supplementary files…',
      current: 0,
      total: supplementaryFiles.length,
    });
    supplements = await uploadSupplementaryFiles(templateId, supplementaryFiles, (p) => {
      onProgress?.({ phase: 'upload', message: `Uploading ${p.name}…`, current: p.current, total: p.total });
    });
  }

  if (images.length || supplements.length) {
    onProgress?.({ phase: 'attach', message: 'Saving attachments…' });
    const attached = await api('PATCH', {
      templateId,
      editKey,
      images,
      supplementaryFiles: supplements,
    });
    imageCount = attached.imageCount || images.length;
    supplementaryCount = attached.supplementaryCount || supplements.length;
  }

  onProgress?.({ phase: 'done', message: 'Done' });
  return { templateId, editKey, imageCount, supplementaryCount };
}
