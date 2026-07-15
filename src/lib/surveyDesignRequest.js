/**
 * Client helpers for public "Request Survey Design".
 */

import { isR2Configured, uploadImageToR2, getR2ServerUrl } from './r2';
import {
  compressImage,
  MAX_SUPPLEMENTARY_BYTES,
  MAX_SUPPLEMENTARY_FILES,
  SUPPLEMENTARY_ACCEPT,
} from './templateRequest';

export { MAX_SUPPLEMENTARY_BYTES, MAX_SUPPLEMENTARY_FILES, SUPPLEMENTARY_ACCEPT, compressImage };

export const MAX_MEDIA_FILES = 200;

const SERVER_URL = getR2ServerUrl();

export const STIMULUS_OPTIONS = [
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'mixed', label: 'Mixed media' },
  { value: 'other', label: 'Other / not sure yet' },
];

function mediaPrefix(requestId) {
  return `survey-design-requests/${requestId}/`;
}

async function api(method, body) {
  const res = await fetch(`${SERVER_URL}/api/survey-design-request`, {
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

export async function uploadDesignMedia(requestId, files, onProgress) {
  if (!files?.length) return [];
  if (!isR2Configured()) {
    throw new Error('File storage is not configured (REACT_APP_R2_PUBLIC_URL).');
  }
  const prefix = `${mediaPrefix(requestId)}media/`;
  const uploaded = [];
  const list = Array.from(files).slice(0, MAX_MEDIA_FILES);
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    onProgress?.({ current: i + 1, total: list.length, name: raw.name });
    const isImage = raw.type?.startsWith('image/');
    const file = isImage ? await compressImage(raw) : raw;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}${Date.now()}_${i}_${safeName}`;
    const result = await uploadImageToR2(file, key);
    if (!result.success) {
      throw new Error(result.error || `Failed to upload ${raw.name}`);
    }
    const type = raw.type?.startsWith('video/')
      ? 'video'
      : raw.type?.startsWith('audio/')
        ? 'audio'
        : 'image';
    uploaded.push({
      url: result.url,
      name: raw.name,
      key: result.key || key,
      type,
      media_id: result.key || key,
      folder: 'media',
    });
  }
  return uploaded;
}

export async function uploadDesignSupplementary(requestId, files, onProgress) {
  if (!files?.length) return [];
  if (!isR2Configured()) {
    throw new Error('File storage is not configured (REACT_APP_R2_PUBLIC_URL).');
  }
  const prefix = `${mediaPrefix(requestId)}supplementary/`;
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
 * Full guest submit:
 * 1) create pending request
 * 2) upload optional media + supplementary files
 * 3) attach metadata
 */
export async function submitSurveyDesignRequest({
  contactName,
  email,
  affiliation,
  studyTitle,
  researchBrief,
  stimulusTypes,
  timeline,
  relatedUrl,
  notes,
  files,
  supplementaryFiles,
  onProgress,
}) {
  onProgress?.({ phase: 'create', message: 'Creating request…' });
  const created = await api('POST', {
    contactName,
    email,
    affiliation,
    studyTitle,
    researchBrief,
    stimulusTypes,
    timeline,
    relatedUrl,
    notes,
    mediaFiles: [],
    supplementaryFiles: [],
  });

  const requestId = created.requestId;
  const editKey = created.editKey;
  let mediaCount = 0;
  let supplementaryCount = 0;
  let mediaFiles = [];
  let supplements = [];

  if (files?.length) {
    onProgress?.({
      phase: 'upload',
      message: 'Uploading media…',
      current: 0,
      total: files.length,
    });
    mediaFiles = await uploadDesignMedia(requestId, files, (p) => {
      onProgress?.({
        phase: 'upload',
        message: `Uploading ${p.name}…`,
        current: p.current,
        total: p.total,
      });
    });
  }

  if (supplementaryFiles?.length) {
    onProgress?.({
      phase: 'upload',
      message: 'Uploading supplementary files…',
      current: 0,
      total: supplementaryFiles.length,
    });
    supplements = await uploadDesignSupplementary(requestId, supplementaryFiles, (p) => {
      onProgress?.({
        phase: 'upload',
        message: `Uploading ${p.name}…`,
        current: p.current,
        total: p.total,
      });
    });
  }

  if (mediaFiles.length || supplements.length) {
    onProgress?.({ phase: 'attach', message: 'Saving attachments…' });
    const attached = await api('PATCH', {
      requestId,
      editKey,
      mediaFiles,
      supplementaryFiles: supplements,
    });
    mediaCount = attached.mediaCount || mediaFiles.length;
    supplementaryCount = attached.supplementaryCount || supplements.length;
  }

  onProgress?.({ phase: 'done', message: 'Done' });
  return { requestId, editKey, mediaCount, supplementaryCount };
}
