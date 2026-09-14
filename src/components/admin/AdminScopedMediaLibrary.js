import { useMediaLibraryText } from '../../contexts/mediaLibraryI18n';
/**
 * Admin Media Library for template or project prefixes.
 * Same folder / set / category tooling as researcher MediaFolderBrowser.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, IconButton, LinearProgress,
  Stack, TextField, Typography, MenuItem, Select, FormControl, InputLabel,
  Tooltip,
} from '@mui/material';
import {
  AttachFile, CloudUpload, Refresh, DeleteForever, Delete, CloudDownload, SelectAll, Deselect,
  DriveFileMove, OpenInNew, Visibility, Audiotrack, PhotoLibrary,
} from '@mui/icons-material';
import MediaFolderBrowser from './MediaFolderBrowser';
import MediaKeywordSelection from './MediaKeywordSelection';
import { mergeMediaLibraryListing, serializeMediaLibraryEntry } from '../../lib/mediaLibrarySync';
import { mediaSelectionCandidates } from '../../lib/mediaLibrarySelection';
import { uploadFolderForFile, uploadObjectKey, pickUploadMedia } from '../../lib/mediaUploadBatch';
import MediaFilePreviewDialog from './MediaFilePreviewDialog';
import {
  normalizeMediaEntry, sortMediaByName, MEDIA_ACCEPT, buildProjectMediaKey,
  normalizeFolderPath, getDirectChildMedia, inferMediaType,
  sanitizeMediaFolderConfig, assertAvMediaUploadAllowed, IMAGE_COMPRESS_TARGET_BYTES,
  MAX_AV_MEDIA_BYTES, formatMediaMb,
} from '../../lib/mediaUtils';
import {
  downloadMediaEntriesZip,
  downloadFolderMediaZip,
  downloadFeatureCsvsZip,
} from '../../lib/mediaLibraryDownload';
import { L0_MODEL } from '../../lib/imageFeaturesL0';
import { SEG_MODEL } from '../../lib/falInference';
import {
  isR2Configured, listImagesFromR2, uploadImageToR2, deleteImagesFromR2,
} from '../../lib/r2';
import { asyncPool } from '../../lib/asyncPool';
import {
  MAX_SUPPLEMENTARY_BYTES,
  MAX_SUPPLEMENTARY_FILES,
  SUPPLEMENTARY_ACCEPT,
} from '../../lib/templateRequest';

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readSupplementaryFiles(owner) {
  const fromConfig = owner?.config?._paperRequest?.supplementaryFiles;
  if (Array.isArray(fromConfig)) return fromConfig;
  if (Array.isArray(owner?.supplementaryFiles)) return owner.supplementaryFiles;
  return [];
}

function readSurveyConfig(owner) {
  return (owner?.config && typeof owner.config === 'object') ? owner.config : {};
}

function compressImage(file, maxBytes = IMAGE_COMPRESS_TARGET_BYTES, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) {
    return Promise.resolve(file);
  }
  return new Promise((resolve) => {
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
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function entryId(entry) {
  return entry?.media_id || entry?.key || `${entry?.folder || ''}/${entry?.name}` || entry?.name;
}

/**
 * @param {object} props
 * @param {string} props.r2Prefix
 * @param {object} props.owner - { id, preloadedImages, imageDatasetConfig, preloadedSource }
 * @param {(next: object) => Promise<void>|void} props.onPersist
 * @param {boolean} [props.allowTemplateKeys]
 * @param {boolean} [props.enableSupplementary] - show PDF/doc panel (defaults on for templates)
 * @param {string} [props.rootLabel]
 * @param {string} [props.userId] - optional; used only when r2Prefix not enough for MediaFolderBrowser
 * @param {string|null} [props.thumbnailUrl] - current landing cover URL (templates)
 * @param {(url: string|null) => Promise<void>|void} [props.onSetThumbnail]
 */
export default function AdminScopedMediaLibrary({
  r2Prefix,
  owner,
  onPersist,
  allowTemplateKeys = false,
  enableSupplementary = null,
  rootLabel = '(root)',
  userId = 'admin',
  onImagesChange = null,
  thumbnailUrl = null,
  onSetThumbnail = null,
}) {
  const tx = useMediaLibraryText();
  const prefix = String(r2Prefix || '').replace(/\/?$/, '/');
  const showSupplementary = enableSupplementary ?? !!allowTemplateKeys;
  const [mediaOwner, setMediaOwner] = useState(() => ({
    id: owner?.id,
    preloadedImages: owner?.preloadedImages || [],
    imageDatasetConfig: owner?.imageDatasetConfig || sanitizeMediaFolderConfig({}),
    preloadedSource: owner?.preloadedSource || 'r2',
    preloadedAt: owner?.preloadedAt || null,
  }));
  const mediaOwnerRef = useRef(mediaOwner);
  mediaOwnerRef.current = mediaOwner;
  const [surveyConfig, setSurveyConfig] = useState(() => readSurveyConfig(owner));
  const [supplementaryFiles, setSupplementaryFiles] = useState(() => readSupplementaryFiles(owner));
  const [currentFolder, setCurrentFolder] = useState('');
  const [selectedFolders, setSelectedFolders] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [openMoveSignal, setOpenMoveSignal] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState({ active: false, progress: 0, total: 0 });
  const [suppUploading, setSuppUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [previewEntry, setPreviewEntry] = useState(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const suppInputRef = useRef(null);
  const persistRef = useRef(onPersist);
  useEffect(() => { persistRef.current = onPersist; }, [onPersist]);

  const r2DeleteOptions = useMemo(
    () => (allowTemplateKeys ? { allowTemplateKeys: true } : null),
    [allowTemplateKeys],
  );

  // Reset when owner identity changes
  useEffect(() => {
    const nextOwner = {
      id: owner?.id,
      preloadedImages: owner?.preloadedImages || [],
      imageDatasetConfig: {
        ...sanitizeMediaFolderConfig({}),
        ...(owner?.imageDatasetConfig || {}),
      },
      preloadedSource: owner?.preloadedSource || 'r2',
      preloadedAt: owner?.preloadedAt || null,
    };
    mediaOwnerRef.current = nextOwner;
    setMediaOwner(nextOwner);
    setSurveyConfig(readSurveyConfig(owner));
    setSupplementaryFiles(readSupplementaryFiles(owner));
    setCurrentFolder('');
    setSelectedFolders(new Set());
    setSelected(new Set());
    setError('');
    setInfo('');
  }, [owner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async (nextOwner, { silent = false, throwOnError = false } = {}) => {
    try {
      await persistRef.current?.({
        preloaded_images: (nextOwner.preloadedImages || []).map((img) => {
          const e = serializeMediaLibraryEntry(img, prefix);
          return {
            ...e,
            url: e.url,
            name: e.name,
            type: e.type || 'image',
            folder: e.folder || '',
            key: e.key || buildProjectMediaKey(prefix, e.folder, e.name),
            media_id: e.media_id || e.key || e.name,
          };
        }),
        preloaded_at: nextOwner.preloadedAt || new Date().toISOString(),
        preloaded_source: nextOwner.preloadedSource || 'r2',
        image_dataset_config: {
          ...sanitizeMediaFolderConfig(nextOwner.imageDatasetConfig),
        },
      });
      mediaOwnerRef.current = nextOwner;
      setMediaOwner(nextOwner);
      onImagesChange?.(nextOwner.preloadedImages || []);
      if (!silent) setInfo('Saved.');
    } catch (err) {
      setError(err.message || tx("Failed to save"));
      if (throwOnError) throw err;
    }
  }, [prefix, onImagesChange]);

  const refreshFromR2 = useCallback(async ({ silent = false } = {}) => {
    if (!prefix || !isR2Configured()) return;
    const startingOwner = mediaOwnerRef.current;
    setSyncing(true);
    if (!silent) setError('');
    try {
      const result = await listImagesFromR2(prefix);
      if (!result.success) {
        // List API unavailable (e.g. local CRA without Express): keep DB/saved library.
        // Do not label the library "offline" — public/static URLs are already synced.
        if (result.unreachable || /load failed|failed to fetch|unreachable/i.test(result.error || '')) {
          if (!silent) {
            setError(
              tx("Could not refresh the R2 file list (API proxy unreachable). Saved media is unchanged."),
            );
          }
          return;
        }
        throw new Error(result.error || tx("Failed to list media"));
      }
      // A delayed listing must not overwrite a move/upload completed since it started.
      if (mediaOwnerRef.current !== startingOwner) return;
      const mapped = mergeMediaLibraryListing(result.images || [], startingOwner.preloadedImages, prefix);
      // Refresh only syncs file list — keep folder tags untouched
      await persistRef.current?.({
        preloaded_images: mapped.map((img) => {
          const e = serializeMediaLibraryEntry(img, prefix);
          return {
            ...e,
            url: e.url,
            name: e.name,
            type: e.type || 'image',
            folder: e.folder || '',
            key: e.key || buildProjectMediaKey(prefix, e.folder, e.name),
            media_id: e.media_id || e.key || e.name,
          };
        }),
        preloaded_at: new Date().toISOString(),
        preloaded_source: 'r2',
      });
      if (mediaOwnerRef.current !== startingOwner) return;
      const nextOwner = {
        ...startingOwner,
        preloadedImages: mapped,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'r2',
      };
      mediaOwnerRef.current = nextOwner;
      setMediaOwner(nextOwner);
      onImagesChange?.(mapped);
      if (!silent) setInfo(tx("Synced {v0} file(s) from R2.", { v0: mapped.length }));
    } catch (err) {
      if (!silent) setError(err.message || tx("Refresh failed"));
    } finally {
      setSyncing(false);
    }
  }, [prefix, onImagesChange]);

  useEffect(() => {
    if (owner?.id && prefix) refreshFromR2({ silent: true });
    // intentionally once per owner open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.id, prefix]);

  const handleOwnerUpdate = useCallback((updated, options) => {
    return persist({
      id: updated.id || mediaOwner.id,
      preloadedImages: updated.preloadedImages || [],
      imageDatasetConfig: updated.imageDatasetConfig || {},
      preloadedSource: updated.preloadedSource || 'r2',
      preloadedAt: updated.preloadedAt || new Date().toISOString(),
    }, options);
  }, [mediaOwner.id, persist]);

  const pool = mediaOwner.preloadedImages || [];
  const folderView = useMemo(
    () => getDirectChildMedia(pool, currentFolder || '', prefix),
    [pool, currentFolder, prefix],
  );

  const filteredMedia = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    return folderView.filter((img) => {
      if (mediaFilter !== 'all' && (img.type || inferMediaType(img.name)) !== mediaFilter) {
        return false;
      }
      if (!q) return true;
      return String(img.name || '').toLowerCase().includes(q)
        || String(img.folder || '').toLowerCase().includes(q);
    });
  }, [folderView, mediaSearch, mediaFilter]);

  const selectionCandidates = useMemo(() => mediaSelectionCandidates(pool, {
    folders: selectedFolders, currentFolder, search: mediaSearch, type: mediaFilter, prefix,
  }), [pool, selectedFolders, currentFolder, mediaSearch, mediaFilter, prefix]);

  const selectedEntries = useMemo(
    () => pool.filter((m) => selected.has(entryId(normalizeMediaEntry(m, prefix)))),
    [pool, selected, prefix],
  );
  const singleSelectedImage = useMemo(() => {
    if (!onSetThumbnail || selectedEntries.length !== 1) return null;
    const e = normalizeMediaEntry(selectedEntries[0], prefix);
    const mediaType = e?.type || inferMediaType(e?.name || e?.url);
    return mediaType === 'image' && e?.url ? e : null;
  }, [onSetThumbnail, selectedEntries, prefix]);

  const toggleSelect = (img) => {
    const id = entryId(normalizeMediaEntry(img, prefix));
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected(new Set(selectionCandidates.map((img) => entryId(normalizeMediaEntry(img, prefix)))));
  };

  const handleUpload = async (fileList) => {
    if (!isR2Configured()) { setError(tx("Cloudflare R2 is not configured.")); return; }
    const { files, skipped } = pickUploadMedia(fileList);
    if (!files.length) { setInfo(tx("No supported media files found in this selection.")); return; }
    setUploading({ active: true, progress: 0, total: files.length });
    setError('');
    setInfo('');
    const folder = normalizeFolderPath(currentFolder || '');
    let completed = 0;
    let okCount = 0;
    let failCount = 0;
    const uploaded = [...pool];

    const results = await asyncPool(6, files, async (file) => {
      try {
        const folderForFile = uploadFolderForFile(file, folder);
        const type = inferMediaType(file.name);
        assertAvMediaUploadAllowed(file, type);
        const isImage = type === 'image' || file.type.startsWith('image/');
        const payload = isImage && !/\.gif$/i.test(file.name) ? await compressImage(file) : file;
        const safeName = file.name;
        const id = typeof window.crypto?.randomUUID === 'function' ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const key = uploadObjectKey(prefix, folderForFile, payload.name, id);
        const result = await uploadImageToR2(payload, key);
        return { safeName, key, result, type, folderForFile };
      } catch (e) {
        return { safeName: file.name, key: null, result: { success: false, error: e.message } };
      } finally {
        completed += 1;
        setUploading((s) => ({ ...s, progress: completed }));
      }
    });

    results.forEach(({ safeName, key, result, type, folderForFile }) => {
      if (result.success) {
        const id = key;
        const filtered = uploaded.filter((img) => {
          const e = normalizeMediaEntry(img, prefix);
          return (e.key || buildProjectMediaKey(prefix, e.folder, e.name)) !== id;
        });
        filtered.push(normalizeMediaEntry({
          url: result.url,
          name: safeName,
          key,
          folder: folderForFile,
          logicalFolder: folderForFile,
          type: type || 'image',
          media_id: key,
        }, prefix));
        uploaded.splice(0, uploaded.length, ...filtered);
        okCount += 1;
      } else {
        failCount += 1;
        if (!error) setError(tx("Upload failed: {v0}", { v0: result.error }));
      }
    });

    setUploading({ active: false, progress: files.length, total: files.length });
    await persist({
      ...mediaOwner,
      preloadedImages: sortMediaByName(uploaded),
      preloadedAt: new Date().toISOString(),
      preloadedSource: 'r2',
    });
    setInfo((failCount > 0
      ? tx("Uploaded {v0}, {v1} failed.", { v0: okCount, v1: failCount })
      : tx("Uploaded {v0} file(s) to {v1}.", { v0: okCount, v1: folder || tx('root') }))
      + (skipped ? tx(" Skipped {v0} non-media or system files.", { v0: skipped }) : ''));
  };

  const handleDeleteSelected = async () => {
    if (!selectedEntries.length) return;
    setBusy(true);
    setError('');
    try {
      const keys = selectedEntries
        .map((e) => {
          const n = normalizeMediaEntry(e, prefix);
          return n.key || buildProjectMediaKey(prefix, n.folder, n.name);
        })
        .filter(Boolean);
      if (keys.length) {
        const del = await deleteImagesFromR2(keys, {
          allowedPrefix: prefix,
          allowTemplateKeys: !!allowTemplateKeys,
        });
        if (!del.success) throw new Error(del.error || tx("Delete failed"));
      }
      const remove = new Set(keys);
      const remaining = pool.filter((raw) => {
        const e = normalizeMediaEntry(raw, prefix);
        const k = e.key || buildProjectMediaKey(prefix, e.folder, e.name);
        return !remove.has(k);
      });
      setSelected(new Set());
      await persist({
        ...mediaOwner,
        preloadedImages: remaining,
        preloadedAt: new Date().toISOString(),
      });
      setInfo(tx("Deleted {v0} file(s).", { v0: keys.length }));
    } catch (err) {
      setError(err.message || tx("Delete failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm(tx("Clear ALL media under this prefix? This cannot be undone."))) return;
    setBusy(true);
    setError('');
    try {
      const listed = await listImagesFromR2(prefix);
      const keys = listed.success ? (listed.images || []).map((img) => img.key).filter(Boolean) : [];
      if (keys.length) {
        const del = await deleteImagesFromR2(keys, {
          allowedPrefix: prefix,
          allowTemplateKeys: !!allowTemplateKeys,
        });
        if (!del.success) throw new Error(del.error || tx("Clear failed"));
      }
      setSelected(new Set());
      setCurrentFolder('');
      await persist({
        ...mediaOwner,
        preloadedImages: [],
        preloadedAt: null,
        preloadedSource: null,
        imageDatasetConfig: sanitizeMediaFolderConfig({}),
      });
      setInfo(tx("Cleared all media and folder tags."));
    } catch (err) {
      setError(err.message || tx("Clear failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (!selectedEntries.length) return;
    setBusy(true);
    setError('');
    try {
      const { succeeded, failed, failures, filename } = await downloadMediaEntriesZip(selectedEntries, {
        projectPrefix: prefix,
        filename: `media_selected_${new Date().toISOString().slice(0, 10)}.zip`,
      });
      const failHint = failed > 0
        ? tx(" {v0} failed ({v1}{v2}).", { v0: failed, v1: failures.slice(0, 2).map((f) => f.name).join(', '), v2: failures.length > 2 ? '…' : '' })
        : '';
      setInfo(tx("ZIP {v0}: {v1} file(s), folders preserved.{v2}", { v0: filename, v1: succeeded, v2: failHint }));
    } catch (err) {
      setError(err.message || tx("Download failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadFolderRecursive = async () => {
    if (!pool.length) return;
    setBusy(true);
    setError('');
    try {
      const { succeeded, failed, failures, filename } = await downloadFolderMediaZip(pool, currentFolder || '', {
        projectPrefix: prefix,
      });
      const failHint = failed > 0
        ? tx(" {v0} failed ({v1}{v2}).", { v0: failed, v1: failures.slice(0, 2).map((f) => f.name).join(', '), v2: failures.length > 2 ? '…' : '' })
        : '';
      setInfo(tx("ZIP {v0}: {v1} file(s) under {v2} (recursive).{v3}", { v0: filename, v1: succeeded, v2: currentFolder || tx('root'), v3: failHint }));
    } catch (err) {
      setError(err.message || tx("Download failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadFeatureCsvs = async () => {
    if (!prefix || !isR2Configured()) return;
    setBusy(true);
    setError('');
    try {
      const { filename, included, missing } = await downloadFeatureCsvsZip(prefix, {
        models: [L0_MODEL, SEG_MODEL],
      });
      const missHint = missing.length ? tx(" Missing: {v0}.", { v0: missing.join(', ') }) : '';
      setInfo(tx("Downloaded {v0} ({v1}).{v2}", { v0: filename, v1: included.join(', '), v2: missHint }));
    } catch (err) {
      setError(err.message || tx("Download failed"));
    } finally {
      setBusy(false);
    }
  };

  const persistSupplementary = async (nextFiles, { silent = false } = {}) => {
    const nextConfig = {
      ...surveyConfig,
      _paperRequest: {
        ...(surveyConfig._paperRequest || {}),
        supplementaryFiles: nextFiles,
      },
    };
    setSurveyConfig(nextConfig);
    setSupplementaryFiles(nextFiles);
    try {
      await persistRef.current?.({ survey_config: nextConfig });
      if (!silent) setInfo(tx("Supplementary files updated."));
    } catch (err) {
      setError(err.message || tx("Failed to save supplementary files"));
    }
  };

  const handleUploadSupplementary = async (fileList) => {
    if (!isR2Configured()) { setError(tx("Cloudflare R2 is not configured.")); return; }
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const room = MAX_SUPPLEMENTARY_FILES - supplementaryFiles.length;
    if (room <= 0) {
      setError(tx("Supplementary file limit reached ({v0}).", { v0: MAX_SUPPLEMENTARY_FILES }));
      return;
    }
    const batch = files.slice(0, room);
    const oversized = batch.find((f) => f.size > MAX_SUPPLEMENTARY_BYTES);
    if (oversized) {
      setError(tx("\"{v0}\" is too large (max {v1} MB).", { v0: oversized.name, v1: Math.round(MAX_SUPPLEMENTARY_BYTES / (1024 * 1024)) }));
      return;
    }
    setSuppUploading(true);
    setError('');
    setInfo('');
    const uploaded = [...supplementaryFiles];
    try {
      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${prefix}supplementary/${Date.now()}_${i}_${safeName}`;
        const result = await uploadImageToR2(file, key);
        if (!result.success) throw new Error(result.error || tx("Failed to upload {v0}", { v0: file.name }));
        uploaded.push({
          url: result.url,
          name: file.name,
          key: result.key || key,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        });
      }
      await persistSupplementary(uploaded.slice(0, MAX_SUPPLEMENTARY_FILES));
      setInfo(tx("Uploaded {v0} supplementary file(s).", { v0: batch.length }));
    } catch (err) {
      setError(err.message || tx("Supplementary upload failed"));
    } finally {
      setSuppUploading(false);
    }
  };

  const handleDeleteSupplementary = async (file) => {
    if (!file) return;
    if (!window.confirm(tx("Delete supplementary file \"{v0}\"?", { v0: file.name }))) return;
    setBusy(true);
    setError('');
    try {
      if (file.key) {
        const del = await deleteImagesFromR2([file.key], {
          allowedPrefix: prefix,
          allowTemplateKeys: !!allowTemplateKeys,
        });
        if (!del.success) throw new Error(del.error || tx("Delete failed"));
      }
      const next = supplementaryFiles.filter((f) => {
        if (file.key && f.key) return f.key !== file.key;
        return !(f.url === file.url && f.name === file.name);
      });
      await persistSupplementary(next);
    } catch (err) {
      setError(err.message || tx("Delete failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      {!isR2Configured() && (
        <Alert severity="warning" sx={{ mb: 2 }}>{' '}{tx("Cloudflare R2 is not configured.")}{' '}</Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {info && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo('')}>{info}</Alert>}

      {showSupplementary && (
        <Box
          sx={{
            mb: 2.5,
            p: 2,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'grey.50',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <AttachFile fontSize="small" color="action" />
            <Typography variant="subtitle2" fontWeight={700}>{' '}{tx("Supplementary files")}{' '}</Typography>
            <Chip size="small" label={`${supplementaryFiles.length} / ${MAX_SUPPLEMENTARY_FILES}`} />
            <Box flex={1} />
            <input
              ref={suppInputRef}
              type="file"
              accept={SUPPLEMENTARY_ACCEPT}
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handleUploadSupplementary(e.target.files); e.target.value = ''; }}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<CloudUpload />}
              disabled={!isR2Configured() || suppUploading || busy
                || supplementaryFiles.length >= MAX_SUPPLEMENTARY_FILES}
              onClick={() => suppInputRef.current?.click()}
            >
              {suppUploading ? tx("Uploading…") : tx("Upload PDF / docs")}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{' '}{tx("Paper request attachments (PDF, Word, ZIP, etc.). Kept separate from survey dataset media.")}{' '}</Typography>
          {supplementaryFiles.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{' '}{tx("No supplementary files yet.")}{' '}</Typography>
          ) : (
            <Stack spacing={0.75}>
              {supplementaryFiles.map((f) => (
                <Stack
                  key={f.key || `${f.name}-${f.url}`}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <AttachFile fontSize="small" color="action" />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap title={f.name}>
                      {f.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[f.contentType, formatBytes(f.size)].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  <Tooltip title={tx("Open / download")}>
                    <IconButton
                      size="small"
                      component="a"
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      disabled={!f.url}
                    >
                      <OpenInNew fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={tx("Delete")}>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={busy || suppUploading}
                      onClick={() => handleDeleteSupplementary(f)}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      )}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Chip
          label={syncing ? tx("Syncing…") : tx("{v0} file(s)", { v0: pool.length })}
          color={pool.length > 0 ? 'success' : 'default'}
          variant="outlined"
          icon={syncing ? <CircularProgress size={14} /> : undefined}
        />
        <Chip size="small" variant="outlined" label={prefix} sx={{ fontFamily: 'monospace', maxWidth: 360 }} />
        <Box flex={1} />
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
        />
        <input ref={folderInputRef} type="file" webkitdirectory="" multiple style={{ display: 'none' }}
          aria-label={tx("Upload media folder")}
          onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }} />
        <Button
          startIcon={<CloudUpload />}
          variant="contained"
          size="small"
          disabled={!isR2Configured() || uploading.active || busy}
          onClick={() => fileInputRef.current?.click()}
        >{' '}{tx("Upload")}{currentFolder ? ` → ${currentFolder}` : ` → ${tx('root')}`}
        </Button>
        <Button variant="outlined" size="small" disabled={!isR2Configured() || uploading.active || busy}
          onClick={() => folderInputRef.current?.click()}>{tx("Upload folder")}</Button>
        <Typography variant="caption" color="text.secondary">{' '}{tx("Images ~300 KB · A/V max")}{' '}{formatMediaMb(MAX_AV_MEDIA_BYTES)} MB
        </Typography>
        <Button
          startIcon={<Refresh />}
          size="small"
          disabled={syncing || uploading.active || busy}
          onClick={() => refreshFromR2()}
        >{' '}{tx("Refresh")}{' '}</Button>
        <Button
          startIcon={<DeleteForever />}
          size="small"
          color="error"
          disabled={!pool.length || busy || uploading.active}
          onClick={handleClearAll}
        >{' '}{tx("Clear all")}{' '}</Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{' '}{tx("Folder uploads keep the selected folder name and all media subfolders inside the current directory. Non-media files and empty folders are omitted.")}{' '}</Typography>
      {uploading.active && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2">{tx("Uploading…")}</Typography>
            <Typography variant="body2" color="text.secondary">
              {uploading.progress} / {uploading.total}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={uploading.total > 0 ? (uploading.progress / uploading.total) * 100 : 0}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>
      )}

      <MediaFolderBrowser
        currentProject={mediaOwner}
        userId={userId}
        onProjectUpdate={handleOwnerUpdate}
        currentFolder={currentFolder}
        onCurrentFolderChange={setCurrentFolder}
        selectedFolders={selectedFolders}
        onSelectedFoldersChange={setSelectedFolders}
        onMoveComplete={() => setSelected(new Set())}
        selectedMediaEntries={selectedEntries}
        openMoveSignal={openMoveSignal}
        mediaCount={pool.length}
        r2Prefix={prefix}
        r2DeleteOptions={r2DeleteOptions}
        rootLabel={rootLabel}
      >
        {selectedFolders.size > 0 && <Alert severity="info" sx={{ mb: 1.5 }}>{' '}{tx("Select filtered uses")}{' '}{selectedFolders.size}{' '}{tx("checked folder(s), including subfolders, and the current search/type filters.")}{' '}{' '}{selectionCandidates.length}{' '}{tx("matching file(s). The gallery shows the open folder.")}{' '}</Alert>}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }} alignItems="center">
          <TextField
            size="small"
            placeholder={tx("Search")}
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
            sx={{ width: 160 }}
          />
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>{tx("Type")}</InputLabel>
            <Select
              label={tx("Type")}
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value)}
            >
              <MenuItem value="all">{tx("All")}</MenuItem>
              <MenuItem value="image">{tx("Image")}</MenuItem>
              <MenuItem value="video">{tx("Video")}</MenuItem>
              <MenuItem value="audio">{tx("Audio")}</MenuItem>
            </Select>
          </FormControl>
          <MediaKeywordSelection
            pool={pool} folders={selectedFolders} currentFolder={currentFolder} prefix={prefix}
            selected={selected} getId={(raw) => entryId(normalizeMediaEntry(raw, prefix))}
            disabled={busy || uploading.active}
            onSelect={(matches) => setSelected((prev) => new Set([...prev, ...matches.map((raw) => entryId(normalizeMediaEntry(raw, prefix)))]))}
          />
          <Button size="small" variant="outlined" startIcon={<SelectAll />} onClick={selectAllFiltered} disabled={!selectionCandidates.length}>{' '}{tx("Select filtered (")}{selectionCandidates.length})
          </Button>
          <Button size="small" variant="outlined" startIcon={<Deselect />} onClick={() => setSelected(new Set())} disabled={!selected.size}>{' '}{tx("Clear selection")}{' '}</Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudDownload />}
            disabled={!selected.size || busy}
            onClick={handleDownloadSelected}
          >{' '}{tx("ZIP selected (")}{selected.size})
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudDownload />}
            disabled={!pool.length || busy}
            onClick={handleDownloadFolderRecursive}
          >{' '}{tx("ZIP folder+subfolders")}{' '}</Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudDownload />}
            disabled={!prefix || !isR2Configured() || busy}
            onClick={handleDownloadFeatureCsvs}
          >{' '}{tx("Download L0 + Seg CSV")}{' '}</Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DriveFileMove />}
            disabled={!selected.size || busy}
            onClick={() => setOpenMoveSignal((n) => n + 1)}
          >{' '}{tx("Move (")}{selected.size})
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<Delete />}
            disabled={!selected.size || busy}
            onClick={handleDeleteSelected}
          >{' '}{tx("Delete (")}{selected.size})
          </Button>
          {onSetThumbnail && (
            <>
              <Button
                size="small"
                variant="contained"
                startIcon={<PhotoLibrary />}
                disabled={!singleSelectedImage || busy}
                onClick={() => onSetThumbnail(singleSelectedImage.url)}
              >
                设为首页封面
              </Button>
              {thumbnailUrl && (
                <Button
                  size="small"
                  variant="text"
                  disabled={busy}
                  onClick={() => onSetThumbnail(null)}
                >
                  清除封面
                </Button>
              )}
            </>
          )}
        </Stack>

        {filteredMedia.length === 0 ? (
          <Alert severity="info">{' '}{tx("No files in")}{' '}{currentFolder || tx('root')}{tx(". Upload here or create folders on the left and tag them as set / category.")}{' '}</Alert>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{' '}{tx("Click a file to preview (image / video / audio). Use checkboxes to select for download, move, or delete")}{' '}{onSetThumbnail ? tx(" — or set one image as the landing cover.") : '.'}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {filteredMedia.map((img) => {
                const e = normalizeMediaEntry(img, prefix);
                const id = entryId(e);
                const isSelected = selected.has(id);
                const isCover = !!(thumbnailUrl && e.url === thumbnailUrl);
                const mediaType = e.type || inferMediaType(e.name || e.url);
                const isVideo = mediaType === 'video';
                const isAudio = mediaType === 'audio';
                return (
                  <Box
                    key={id}
                    onClick={() => setPreviewEntry(e)}
                    sx={{
                      width: 120,
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: isCover ? 'warning.main' : isSelected ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      overflow: 'hidden',
                      bgcolor: 'grey.50',
                      '&:hover .media-preview-btn': { opacity: 1 },
                    }}
                  >
                    <Box sx={{ position: 'relative', height: 90, bgcolor: 'grey.200' }}>
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={() => toggleSelect(img)}
                        sx={{ position: 'absolute', top: 0, left: 0, zIndex: 1, p: 0.25, bgcolor: 'rgba(255,255,255,0.85)' }}
                      />
                      {isCover && (
                        <Chip
                          size="small"
                          label={tx("Cover")}
                          color="warning"
                          sx={{
                            position: 'absolute',
                            bottom: 4,
                            left: 4,
                            zIndex: 1,
                            height: 20,
                            fontSize: '0.65rem',
                          }}
                        />
                      )}
                      <Tooltip title={tx("Preview")}>
                        <IconButton
                          className="media-preview-btn"
                          size="small"
                          onClick={(ev) => { ev.stopPropagation(); setPreviewEntry(e); }}
                          sx={{
                            position: 'absolute', top: 2, right: 2, zIndex: 1,
                            bgcolor: 'rgba(255,255,255,0.9)', opacity: 0, transition: 'opacity .15s',
                          }}
                        >
                          <Visibility fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {isVideo ? (
                        <video src={e.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted preload="metadata" />
                      ) : isAudio ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 0.5, px: 1 }}>
                          <Audiotrack fontSize="small" color="action" />
                          <Typography variant="caption">{tx("Audio")}</Typography>
                        </Box>
                      ) : (
                        <img
                          src={e.url}
                          alt={e.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(ev) => { ev.target.style.opacity = 0.3; }}
                        />
                      )}
                    </Box>
                    <Typography variant="caption" sx={{
                      display: 'block', px: 0.5, py: 0.25,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {e.name}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </>
        )}
      </MediaFolderBrowser>

      <MediaFilePreviewDialog
        open={!!previewEntry}
        entry={previewEntry}
        items={filteredMedia.map((img) => normalizeMediaEntry(img, prefix))}
        onNavigate={setPreviewEntry}
        onClose={() => setPreviewEntry(null)}
      />
    </Box>
  );
}
