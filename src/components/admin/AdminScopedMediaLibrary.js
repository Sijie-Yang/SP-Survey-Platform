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
  DriveFileMove, OpenInNew, Visibility, Audiotrack,
} from '@mui/icons-material';
import MediaFolderBrowser from './MediaFolderBrowser';
import MediaFilePreviewDialog from './MediaFilePreviewDialog';
import {
  normalizeMediaEntry, sortMediaByName, MEDIA_ACCEPT, buildProjectMediaKey,
  normalizeFolderPath, getDirectChildMedia, downloadMediaFiles, inferMediaType,
  sanitizeMediaFolderConfig, assertAvMediaUploadAllowed, IMAGE_COMPRESS_TARGET_BYTES,
  MAX_AV_MEDIA_BYTES, formatMediaMb,
} from '../../lib/mediaUtils';
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
}) {
  const prefix = String(r2Prefix || '').replace(/\/?$/, '/');
  const showSupplementary = enableSupplementary ?? !!allowTemplateKeys;
  const [mediaOwner, setMediaOwner] = useState(() => ({
    id: owner?.id,
    preloadedImages: owner?.preloadedImages || [],
    imageDatasetConfig: owner?.imageDatasetConfig || sanitizeMediaFolderConfig({}),
    preloadedSource: owner?.preloadedSource || 'r2',
    preloadedAt: owner?.preloadedAt || null,
  }));
  const [surveyConfig, setSurveyConfig] = useState(() => readSurveyConfig(owner));
  const [supplementaryFiles, setSupplementaryFiles] = useState(() => readSupplementaryFiles(owner));
  const [currentFolder, setCurrentFolder] = useState('');
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
  const suppInputRef = useRef(null);
  const persistRef = useRef(onPersist);
  useEffect(() => { persistRef.current = onPersist; }, [onPersist]);

  const r2DeleteOptions = useMemo(
    () => (allowTemplateKeys ? { allowTemplateKeys: true } : null),
    [allowTemplateKeys],
  );

  // Reset when owner identity changes
  useEffect(() => {
    setMediaOwner({
      id: owner?.id,
      preloadedImages: owner?.preloadedImages || [],
      imageDatasetConfig: {
        ...sanitizeMediaFolderConfig({}),
        ...(owner?.imageDatasetConfig || {}),
      },
      preloadedSource: owner?.preloadedSource || 'r2',
      preloadedAt: owner?.preloadedAt || null,
    });
    setSurveyConfig(readSurveyConfig(owner));
    setSupplementaryFiles(readSupplementaryFiles(owner));
    setCurrentFolder('');
    setSelected(new Set());
    setError('');
    setInfo('');
  }, [owner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(async (nextOwner, { silent = false } = {}) => {
    setMediaOwner(nextOwner);
    onImagesChange?.(nextOwner.preloadedImages || []);
    try {
      await persistRef.current?.({
        preloaded_images: (nextOwner.preloadedImages || []).map((img) => {
          const e = normalizeMediaEntry(img, prefix);
          return {
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
      if (!silent) setInfo('Saved.');
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  }, [prefix, onImagesChange]);

  const refreshFromR2 = useCallback(async ({ silent = false } = {}) => {
    if (!prefix || !isR2Configured()) return;
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
              'Could not refresh the R2 file list (API proxy unreachable). Saved media is unchanged.',
            );
          }
          return;
        }
        throw new Error(result.error || 'Failed to list media');
      }
      const mapped = sortMediaByName(
        (result.images || []).map((img) => normalizeMediaEntry({
          url: img.url,
          name: img.name,
          type: img.type || inferMediaType(img.name),
          key: img.key,
          folder: img.folder,
        }, prefix)),
      );
      setMediaOwner((prev) => ({
        ...prev,
        preloadedImages: mapped,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'r2',
      }));
      onImagesChange?.(mapped);
      // Refresh only syncs file list — keep folder tags untouched
      await persistRef.current?.({
        preloaded_images: mapped.map((img) => {
          const e = normalizeMediaEntry(img, prefix);
          return {
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
      if (!silent) setInfo(`Synced ${mapped.length} file(s) from R2.`);
    } catch (err) {
      if (!silent) setError(err.message || 'Refresh failed');
    } finally {
      setSyncing(false);
    }
  }, [prefix, onImagesChange]);

  useEffect(() => {
    if (owner?.id && prefix) refreshFromR2({ silent: true });
    // intentionally once per owner open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.id, prefix]);

  const handleOwnerUpdate = useCallback((updated) => {
    persist({
      id: updated.id || mediaOwner.id,
      preloadedImages: updated.preloadedImages || [],
      imageDatasetConfig: updated.imageDatasetConfig || {},
      preloadedSource: updated.preloadedSource || 'r2',
      preloadedAt: updated.preloadedAt || new Date().toISOString(),
    });
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

  const selectedEntries = useMemo(
    () => pool.filter((m) => selected.has(entryId(normalizeMediaEntry(m, prefix)))),
    [pool, selected, prefix],
  );

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
    setSelected((prev) => {
      const next = new Set(prev);
      filteredMedia.forEach((img) => next.add(entryId(normalizeMediaEntry(img, prefix))));
      return next;
    });
  };

  const handleUpload = async (fileList) => {
    if (!isR2Configured()) { setError('Cloudflare R2 is not configured.'); return; }
    const files = Array.from(fileList || []);
    if (!files.length) return;
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
        const type = inferMediaType(file.name);
        assertAvMediaUploadAllowed(file, type);
        const isImage = type === 'image' || file.type.startsWith('image/');
        const payload = isImage ? await compressImage(file) : file;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = buildProjectMediaKey(prefix, folder, safeName);
        const result = await uploadImageToR2(payload, key);
        return { safeName, key, result, type };
      } catch (e) {
        return { safeName: file.name, key: null, result: { success: false, error: e.message } };
      } finally {
        completed += 1;
        setUploading((s) => ({ ...s, progress: completed }));
      }
    });

    results.forEach(({ safeName, key, result, type }) => {
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
          folder,
          type: type || 'image',
          media_id: key,
        }, prefix));
        uploaded.splice(0, uploaded.length, ...filtered);
        okCount += 1;
      } else {
        failCount += 1;
        if (!error) setError(`Upload failed: ${result.error}`);
      }
    });

    setUploading({ active: false, progress: files.length, total: files.length });
    await persist({
      ...mediaOwner,
      preloadedImages: sortMediaByName(uploaded),
      preloadedAt: new Date().toISOString(),
      preloadedSource: 'r2',
    });
    setInfo(failCount > 0
      ? `Uploaded ${okCount}, ${failCount} failed.`
      : `Uploaded ${okCount} file(s) to ${folder || 'root'}.`);
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
        if (!del.success) throw new Error(del.error || 'Delete failed');
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
      setInfo(`Deleted ${keys.length} file(s).`);
    } catch (err) {
      setError(err.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Clear ALL media under this prefix? This cannot be undone.')) return;
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
        if (!del.success) throw new Error(del.error || 'Clear failed');
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
      setInfo('Cleared all media and folder tags.');
    } catch (err) {
      setError(err.message || 'Clear failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (!selectedEntries.length) return;
    setBusy(true);
    try {
      await downloadMediaFiles(selectedEntries);
      setInfo(`Downloaded ${selectedEntries.length} file(s).`);
    } catch (err) {
      setError(err.message || 'Download failed');
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
      if (!silent) setInfo('Supplementary files updated.');
    } catch (err) {
      setError(err.message || 'Failed to save supplementary files');
    }
  };

  const handleUploadSupplementary = async (fileList) => {
    if (!isR2Configured()) { setError('Cloudflare R2 is not configured.'); return; }
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const room = MAX_SUPPLEMENTARY_FILES - supplementaryFiles.length;
    if (room <= 0) {
      setError(`Supplementary file limit reached (${MAX_SUPPLEMENTARY_FILES}).`);
      return;
    }
    const batch = files.slice(0, room);
    const oversized = batch.find((f) => f.size > MAX_SUPPLEMENTARY_BYTES);
    if (oversized) {
      setError(`"${oversized.name}" is too large (max ${Math.round(MAX_SUPPLEMENTARY_BYTES / (1024 * 1024))} MB).`);
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
        if (!result.success) throw new Error(result.error || `Failed to upload ${file.name}`);
        uploaded.push({
          url: result.url,
          name: file.name,
          key: result.key || key,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        });
      }
      await persistSupplementary(uploaded.slice(0, MAX_SUPPLEMENTARY_FILES));
      setInfo(`Uploaded ${batch.length} supplementary file(s).`);
    } catch (err) {
      setError(err.message || 'Supplementary upload failed');
    } finally {
      setSuppUploading(false);
    }
  };

  const handleDeleteSupplementary = async (file) => {
    if (!file) return;
    if (!window.confirm(`Delete supplementary file "${file.name}"?`)) return;
    setBusy(true);
    setError('');
    try {
      if (file.key) {
        const del = await deleteImagesFromR2([file.key], {
          allowedPrefix: prefix,
          allowTemplateKeys: !!allowTemplateKeys,
        });
        if (!del.success) throw new Error(del.error || 'Delete failed');
      }
      const next = supplementaryFiles.filter((f) => {
        if (file.key && f.key) return f.key !== file.key;
        return !(f.url === file.url && f.name === file.name);
      });
      await persistSupplementary(next);
    } catch (err) {
      setError(err.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      {!isR2Configured() && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Cloudflare R2 is not configured.
        </Alert>
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
            <Typography variant="subtitle2" fontWeight={700}>
              Supplementary files
            </Typography>
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
              {suppUploading ? 'Uploading…' : 'Upload PDF / docs'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Paper request attachments (PDF, Word, ZIP, etc.). Kept separate from survey dataset media.
          </Typography>
          {supplementaryFiles.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No supplementary files yet.
            </Typography>
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
                  <Tooltip title="Open / download">
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
                  <Tooltip title="Delete">
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
          label={syncing ? 'Syncing…' : `${pool.length} file(s)`}
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
        <Button
          startIcon={<CloudUpload />}
          variant="contained"
          size="small"
          disabled={!isR2Configured() || uploading.active || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload{currentFolder ? ` → ${currentFolder}` : ' → root'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          Images ~300 KB · A/V max {formatMediaMb(MAX_AV_MEDIA_BYTES)} MB
        </Typography>
        <Button
          startIcon={<Refresh />}
          size="small"
          disabled={syncing || uploading.active || busy}
          onClick={() => refreshFromR2()}
        >
          Refresh
        </Button>
        <Button
          startIcon={<DeleteForever />}
          size="small"
          color="error"
          disabled={!pool.length || busy || uploading.active}
          onClick={handleClearAll}
        >
          Clear all
        </Button>
      </Stack>

      {uploading.active && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2">Uploading…</Typography>
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
        selectedMediaEntries={selectedEntries}
        openMoveSignal={openMoveSignal}
        mediaCount={pool.length}
        r2Prefix={prefix}
        r2DeleteOptions={r2DeleteOptions}
        rootLabel={rootLabel}
      >
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }} alignItems="center">
          <TextField
            size="small"
            placeholder="Search"
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
            sx={{ width: 160 }}
          />
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>Type</InputLabel>
            <Select
              label="Type"
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="image">Image</MenuItem>
              <MenuItem value="video">Video</MenuItem>
              <MenuItem value="audio">Audio</MenuItem>
            </Select>
          </FormControl>
          <Button size="small" variant="outlined" startIcon={<SelectAll />} onClick={selectAllFiltered} disabled={!filteredMedia.length}>
            Select filtered
          </Button>
          <Button size="small" variant="outlined" startIcon={<Deselect />} onClick={() => setSelected(new Set())} disabled={!selected.size}>
            Clear selection
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudDownload />}
            disabled={!selected.size || busy}
            onClick={handleDownloadSelected}
          >
            Download ({selected.size})
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DriveFileMove />}
            disabled={!selected.size || busy}
            onClick={() => setOpenMoveSignal((n) => n + 1)}
          >
            Move ({selected.size})
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<Delete />}
            disabled={!selected.size || busy}
            onClick={handleDeleteSelected}
          >
            Delete ({selected.size})
          </Button>
        </Stack>

        {filteredMedia.length === 0 ? (
          <Alert severity="info">
            No files in {currentFolder || 'root'}. Upload here or create folders on the left and tag them as set / category.
          </Alert>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Click a file to preview (image / video / audio). Use checkboxes to select for download, move, or delete.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {filteredMedia.map((img) => {
                const e = normalizeMediaEntry(img, prefix);
                const id = entryId(e);
                const isSelected = selected.has(id);
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
                      borderColor: isSelected ? 'primary.main' : 'divider',
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
                      <Tooltip title="Preview">
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
                          <Typography variant="caption">Audio</Typography>
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
