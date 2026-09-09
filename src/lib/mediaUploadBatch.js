import { buildProjectMediaKey, inferMediaType, MEDIA_FILE_RE, MAX_AV_MEDIA_BYTES } from './mediaUtils';

/** Each upload gets an immutable object name, even when original names collide. */
export function uploadObjectKey(prefix, folder, filename, id) {
  const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dot = safe.lastIndexOf('.');
  const unique = dot > 0 ? `${safe.slice(0, dot)}__${id}${safe.slice(dot)}` : `${safe}__${id}`;
  return buildProjectMediaKey(prefix, folder, unique);
}

/** Files are independent: a failed file never discards the rest of the batch. */
export async function uploadMediaBatch({ files, prefix, folder, prepare, upload, makeId, persist, onProgress = () => {}, shouldStop = () => false }) {
  const uploaded = [];
  const failures = [];
  let processed = 0;
  let saveError = null;
  for (const raw of files) {
    if (shouldStop()) break;
    try {
      if (!MEDIA_FILE_RE.test(raw.name)) throw new Error('Unsupported media format');
      if (raw.size <= 0) throw new Error('File is empty');
      if (raw.size > MAX_AV_MEDIA_BYTES) throw new Error(`File exceeds ${MAX_AV_MEDIA_BYTES / 1024 / 1024} MB`);
      const type = inferMediaType(raw.name);
      const file = await prepare(raw, type);
      const key = uploadObjectKey(prefix, folder, file.name, makeId());
      const result = await upload(file, key);
      if (!result.success) throw new Error(result.error || 'Upload failed');
      uploaded.push({ url: result.url, name: raw.name, type, key, media_id: key, folder: folder || '',
        original_bytes: raw.size, uploaded_bytes: file.size, image_compressed: file !== raw });
    } catch (err) {
      failures.push({ file: raw, name: raw.name, error: err.message || 'Upload failed' });
    }
    processed += 1;
    onProgress({ processed, uploaded: uploaded.length, failed: failures.length });
    if (processed % 10 === 0 && uploaded.length) {
      try { await persist([...uploaded]); } catch (err) { saveError = err.message; break; }
    }
  }
  if (uploaded.length && !saveError) {
    try { await persist([...uploaded]); } catch (err) { saveError = err.message; }
  }
  return { uploaded, failures, pending: files.slice(processed), processed, saveError };
}
