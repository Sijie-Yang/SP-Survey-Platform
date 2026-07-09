import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Switch,
  FormControlLabel,
  IconButton,
  Checkbox,
  Tooltip,
  Pagination,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import {
  Refresh,
  CheckCircle,
  Error as ErrorIcon,
  Warning,
  CloudDownload,
  Delete,
  ExpandMore,
  CloudUpload,
  ContentCopy,
  Search,
  SelectAll,
  Deselect,
} from '@mui/icons-material';
import {
  testHuggingFaceConnection,
  getImagesFromHuggingFace,
  getImageCountFromDataset,
} from '../../lib/huggingface';
import { isR2Configured, uploadImageToR2, deleteImagesFromR2, listImagesFromR2, copyImagesInR2 } from '../../lib/r2';
import { inferMediaType, normalizeMediaEntry, MEDIA_ACCEPT, analyzeMediaGroups, summarizeMediaGroupsBySize, analyzeMediaCategories, downloadMediaFiles } from '../../lib/mediaUtils';
import { MediaPairingGuide } from './MediaPairingGuide';
import { MediaCategoryGuide } from './MediaCategoryGuide';
import { getTemplateById } from '../../lib/templateManager';
import { useRegion } from '../../contexts/RegionContext';
import { useAuth } from '../../contexts/AuthContext';

const MEDIA_PAGE_SIZE = 24;

function safeR2Name(name = '') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function mediaEntryKey(entry, userId, projectId) {
  if (entry?.key) return entry.key;
  if (!entry?.name || !projectId) return null;
  return `${userId}/${projectId}/${safeR2Name(entry.name)}`;
}

export default function ImageDataset({ currentProject, onProjectUpdate, onConfigChange, onNextStep }) {
  useRegion();
  const { user } = useAuth();

  // Direct upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [directUploadStatus, setDirectUploadStatus] = useState({
    loading: false, progress: 0, total: 0, error: null, success: null,
  });
  const fileInputRef = useRef(null);

  // HuggingFace optional section
  const [hfExpanded, setHfExpanded] = useState(false);
  const [hfConfig, setHfConfig] = useState({ enabled: false, token: '', datasetName: '' });
  const [hfStatus, setHfStatus] = useState({ loading: false, connected: false, error: null, datasetInfo: null });
  const [preloadStatus, setPreloadStatus] = useState({ loading: false, progress: 0, total: 0, error: null, success: null });

  // R2 sync state
  const [r2Syncing, setR2Syncing] = useState(false);

  // "Import Template Images" — populated when this project was created
  // from a template (project.templateId is set) and that template has
  // images in its R2 folder. Drives the optional importer UI below.
  const [sourceTemplate, setSourceTemplate] = useState(null);
  const [templateImportStatus, setTemplateImportStatus] = useState({
    loading: false, progress: 0, total: 0, error: null, success: null,
  });

  // Uploaded media library management
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [mediaPage, setMediaPage] = useState(1);
  const [selectedMedia, setSelectedMedia] = useState(() => new Set());
  const [mediaActionStatus, setMediaActionStatus] = useState({ loading: false, error: null, success: null });
  const [mediaDownloadProgress, setMediaDownloadProgress] = useState(null);
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const [groupSizeFilter, setGroupSizeFilter] = useState('all');

  const userId = user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const projectPrefix = projectId ? `${userId}/${projectId}/` : '';

  const normalizeR2Listing = (images = []) => images.map((img) => normalizeMediaEntry({
    url: img.url,
    name: img.name,
    key: img.key,
    type: img.type || inferMediaType(img.name),
  }));

  const persistPreloadedImages = (images, extra = {}) => {
    if (!currentProject) return;
    const updatedProject = {
      ...currentProject,
      preloadedImages: images,
      preloadedAt: images.length ? (extra.preloadedAt || new Date().toISOString()) : null,
      preloadedSource: images.length ? 'r2' : null,
      ...extra,
    };
    onProjectUpdate(updatedProject);
    if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
    return updatedProject;
  };

  const refreshMediaFromR2 = async () => {
    if (!isR2Configured() || !projectId) return;
    setRefreshingMedia(true);
    setMediaActionStatus({ loading: false, error: null, success: null });
    try {
      const result = await listImagesFromR2(projectPrefix);
      if (!result.success) throw new Error(result.error || 'Failed to list media from R2');
      const images = normalizeR2Listing(result.images);
      persistPreloadedImages(images);
      setSelectedMedia(new Set());
      setMediaPage(1);
      setMediaActionStatus({
        loading: false,
        error: null,
        success: `Synced ${images.length} file(s) from Cloudflare R2.`,
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    } finally {
      setRefreshingMedia(false);
    }
  };

  const deleteMediaEntries = async (entries) => {
    if (!entries.length || !currentProject) return;
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const label = entries.length === 1 ? `"${entries[0].name}"` : `${entries.length} files`;
    if (!window.confirm(`Delete ${label} from Cloudflare R2? This cannot be undone.`)) return;

    setMediaActionStatus({ loading: true, error: null, success: null });
    try {
      if (isR2Configured()) {
        const keys = entries
          .map((entry) => mediaEntryKey(entry, userId, projectId))
          .filter(Boolean);
        if (keys.length) {
          const del = await deleteImagesFromR2(keys);
          if (!del.success) throw new Error(del.error || 'Failed to delete from R2');
        }
      }

      const removeNames = new Set(entries.map((e) => e.name));
      const remaining = (currentProject.preloadedImages || []).filter((m) => !removeNames.has(m.name));
      persistPreloadedImages(remaining);
      setSelectedMedia((prev) => {
        const next = new Set(prev);
        removeNames.forEach((n) => next.delete(n));
        return next;
      });
      setMediaActionStatus({
        loading: false,
        error: null,
        success: `Deleted ${entries.length} file(s).`,
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    }
  };

  const handleDeleteSingleMedia = (entry) => deleteMediaEntries([entry]);
  const handleDeleteSelectedMedia = () => {
    const selected = filteredMedia.filter((m) => selectedMedia.has(m.name));
    if (!selected.length) return;
    deleteMediaEntries(selected);
  };

  const downloadMediaEntries = async (entries) => {
    if (!entries.length) return;
    setMediaActionStatus({ loading: true, error: null, success: null });
    setMediaDownloadProgress({ done: 0, total: entries.length });
    try {
      const { succeeded, failed, failures } = await downloadMediaFiles(entries, {
        onProgress: (done, total) => setMediaDownloadProgress({ done, total }),
      });
      if (failed > 0 && succeeded === 0) {
        throw new Error(failures[0]?.error || 'Download failed');
      }
      const failHint = failed > 0
        ? ` ${failed} failed (${failures.slice(0, 2).map((f) => f.name).join(', ')}${failures.length > 2 ? '…' : ''}).`
        : '';
      setMediaActionStatus({
        loading: false,
        error: null,
        success: `Downloaded ${succeeded} of ${entries.length} file(s).${failHint}`,
      });
    } catch (err) {
      setMediaActionStatus({ loading: false, error: err.message, success: null });
    } finally {
      setMediaDownloadProgress(null);
    }
  };

  const handleDownloadSingleMedia = (entry, e) => {
    e?.stopPropagation();
    downloadMediaEntries([entry]);
  };

  const handleDownloadSelectedMedia = () => {
    const selected = filteredMedia.filter((m) => selectedMedia.has(m.name));
    if (!selected.length) return;
    downloadMediaEntries(selected);
  };

  const handleDownloadFilteredMedia = () => {
    if (!filteredMedia.length) return;
    downloadMediaEntries(filteredMedia);
  };

  const filteredMedia = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    return (currentProject?.preloadedImages || []).filter((m) => {
      const t = m.type || inferMediaType(m.name || m.url);
      if (mediaFilter !== 'all' && t !== mediaFilter) return false;
      if (q && !(m.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [currentProject?.preloadedImages, mediaSearch, mediaFilter]);

  const totalMediaPages = Math.max(1, Math.ceil(filteredMedia.length / MEDIA_PAGE_SIZE));
  const pagedMedia = useMemo(() => {
    const start = (mediaPage - 1) * MEDIA_PAGE_SIZE;
    return filteredMedia.slice(start, start + MEDIA_PAGE_SIZE);
  }, [filteredMedia, mediaPage]);

  useEffect(() => {
    setMediaPage(1);
  }, [mediaSearch, mediaFilter]);

  useEffect(() => {
    if (mediaPage > totalMediaPages) setMediaPage(totalMediaPages);
  }, [mediaPage, totalMediaPages]);

  const toggleMediaSelection = (name) => {
    setSelectedMedia((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedMedia(new Set(filteredMedia.map((m) => m.name)));
  };

  const clearMediaSelection = () => setSelectedMedia(new Set());

  // On mount / project change: sync actual image count from R2
  useEffect(() => {
    if (!isR2Configured() || !currentProject?.id || !user?.id) return;
    let cancelled = false;
    const userId = user.id;
    const prefix = `${userId}/${currentProject.id}/`;

    setR2Syncing(true);
    listImagesFromR2(prefix).then((result) => {
      if (cancelled) return;
      setR2Syncing(false);
      if (!result.success || result.images.length === 0) return;
      // If R2 has more images than stored locally, update the project record
      const storedCount = currentProject.preloadedImages?.length || 0;
      if (result.images.length !== storedCount) {
        const images = normalizeR2Listing(result.images);
        onProjectUpdate({
          ...currentProject,
          preloadedImages: images,
          preloadedSource: 'r2',
          preloadedAt: currentProject.preloadedAt || new Date().toISOString(),
        });
      }
    });
    return () => { cancelled = true; };
  }, [currentProject?.id, user?.id]); // eslint-disable-line

  // Scroll position restore
  const scrollRef = useRef(0);
  const restoreScrollRef = useRef(false);
  useEffect(() => {
    if (restoreScrollRef.current) {
      window.scrollTo(0, scrollRef.current);
      restoreScrollRef.current = false;
    }
  });

  // Look up the source template (if this project was created from one)
  // so we can show an "Import Template Images" button when that template
  // ships with images. Done as a separate, idempotent effect so it
  // re-runs on project switch but not on every state change.
  useEffect(() => {
    let cancelled = false;
    setSourceTemplate(null);
    if (!currentProject?.templateId) return undefined;
    getTemplateById(currentProject.templateId).then((tpl) => {
      if (cancelled) return;
      if (tpl && Array.isArray(tpl.preloadedImages) && tpl.preloadedImages.length > 0) {
        setSourceTemplate(tpl);
      }
    });
    return () => { cancelled = true; };
  }, [currentProject?.templateId]);

  // Sync hfConfig from project
  useEffect(() => {
    if (currentProject?.imageDatasetConfig) {
      const c = currentProject.imageDatasetConfig;
      setHfConfig({
        enabled: c.enabled || false,
        token: c.huggingFaceToken || '',
        datasetName: c.datasetName || '',
      });
      if (c.datasetInfo && onConfigChange) {
        setHfStatus(prev => ({ ...prev, connected: true, datasetInfo: c.datasetInfo }));
      }
    }
  }, [currentProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveHfConfig = () => {
    if (!currentProject) return;
    const updated = {
      ...currentProject,
      imageDatasetConfig: {
        ...currentProject.imageDatasetConfig,
        enabled: hfConfig.enabled,
        huggingFaceToken: hfConfig.token,
        datasetName: hfConfig.datasetName,
      },
    };
    onProjectUpdate(updated);
    if (onConfigChange) onConfigChange(true, updated.imageDatasetConfig);
  };

  const testHfConnection = async () => {
    setHfStatus({ loading: true, connected: false, error: null, datasetInfo: null });
    try {
      const result = await testHuggingFaceConnection(hfConfig.token, hfConfig.datasetName);
      if (result.success) {
        setHfStatus({ loading: false, connected: true, error: null, datasetInfo: result.datasetInfo });
      } else {
        setHfStatus({ loading: false, connected: false, error: result.error || 'Connection failed', datasetInfo: null });
      }
    } catch (e) {
      setHfStatus({ loading: false, connected: false, error: e.message, datasetInfo: null });
    }
  };

  // ── Import images from source template ───────────────────────────────────

  const handleImportFromTemplate = async () => {
    if (!sourceTemplate || !currentProject?.id) return;
    if (!isR2Configured()) {
      setTemplateImportStatus(prev => ({
        ...prev,
        error: 'Cloudflare R2 is not configured. Please set REACT_APP_R2_PUBLIC_URL and the server-side R2 environment variables.',
      }));
      return;
    }
    if (templateImportStatus.loading) return;

    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const r2PublicUrl = (process.env.REACT_APP_R2_PUBLIC_URL || '').replace(/\/$/, '');
    const userId = user?.id || 'anonymous';
    const templatePrefix = `templates/${sourceTemplate.id}/`;
    const projectPrefix = `${userId}/${currentProject.id}/`;

    setTemplateImportStatus({ loading: true, progress: 0, total: 0, error: null, success: null });

    try {
      // List what's actually in R2 under the template prefix — this is
      // the same source-of-truth strategy used by the project→template
      // promotion in ProjectSidebar.
      const listed = await listImagesFromR2(templatePrefix);
      if (!listed.success) {
        throw new Error(listed.error || 'Failed to list template images');
      }
      if (listed.images.length === 0) {
        setTemplateImportStatus({
          loading: false, progress: 0, total: 0, error: null,
          success: 'Template has no images to import.',
        });
        return;
      }

      // Don't re-copy files we already have in the project prefix.
      const existing = await listImagesFromR2(projectPrefix);
      const existingNames = new Set((existing.images || []).map((i) => i.name));
      const todo = listed.images
        .filter((img) => !existingNames.has(img.name))
        .map((img) => ({ from: img.key, to: `${projectPrefix}${img.name}` }));

      const total = todo.length;
      setTemplateImportStatus(prev => ({ ...prev, total, progress: 0 }));

      const copiedImages = [];
      const errors = [];
      if (total > 0) {
        const BATCH_SIZE = 10;
        for (let i = 0; i < todo.length; i += BATCH_SIZE) {
          const batch = todo.slice(i, i + BATCH_SIZE);
          const res = await copyImagesInR2(batch);
          if (res.copied?.length) copiedImages.push(...res.copied);
          if (res.errors?.length) errors.push(...res.errors);
          setTemplateImportStatus(prev => ({
            ...prev,
            progress: Math.min(i + batch.length, total),
          }));
        }
      }

      // Build the final preloadedImages list = pre-existing project files
      // (kept as-is) + everything we just copied in. Then re-list once
      // from R2 to make sure the URLs we surface to the project record
      // come from the canonical R2 source rather than the copy response.
      const finalListing = await listImagesFromR2(projectPrefix);
      const finalImages = (finalListing.success ? finalListing.images : [])
        .map((img) => ({
          url: img.url || (r2PublicUrl ? `${r2PublicUrl}/${img.key}` : ''),
          name: img.name,
          key: img.key,
          type: img.type || inferMediaType(img.name),
        }));

      onProjectUpdate({
        ...currentProject,
        preloadedImages: finalImages,
        preloadedSource: 'r2',
        preloadedAt: new Date().toISOString(),
      });

      const newCount = copiedImages.length;
      const skipCount = listed.images.length - todo.length;
      setTemplateImportStatus({
        loading: false,
        progress: total,
        total,
        error: errors.length ? `${errors.length} file(s) failed to copy.` : null,
        success: `Imported ${newCount} image${newCount === 1 ? '' : 's'} from template${skipCount > 0 ? ` (${skipCount} already in project)` : ''}.`,
      });
    } catch (err) {
      setTemplateImportStatus({
        loading: false, progress: 0, total: 0, error: err.message, success: null,
      });
    }
  };

  // ── Direct upload to Cloudflare R2 ────────────────────────────────────────

  // Compress image to stay under maxBytes using Canvas
  const compressImage = (file, maxBytes = 300 * 1024, quality = 0.85) => {
    return new Promise((resolve) => {
      if (file.size <= maxBytes) { resolve(file); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        // Scale down if very large
        const maxDim = 1920;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        // Try progressively lower quality until under maxBytes
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
      img.onerror = () => resolve(file);
      img.src = url;
    });
  };

  const handleDirectUpload = async () => {
    if (!selectedFiles.length) return;
    if (!isR2Configured()) {
      setDirectUploadStatus(prev => ({ ...prev, error: 'Cloudflare R2 is not configured. Please set REACT_APP_R2_PUBLIC_URL and the server-side R2 environment variables.' }));
      return;
    }

    setDirectUploadStatus({ loading: true, progress: 0, total: selectedFiles.length, error: null, success: null });

    try {
      const uploadedImages = [...(currentProject?.preloadedImages || [])];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < selectedFiles.length; i++) {
        const raw = selectedFiles[i];
        const mediaType = inferMediaType(raw.name);
        const file = mediaType === 'image' ? await compressImage(raw) : raw;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const userId = user?.id || 'anonymous';
        const key = `${userId}/${currentProject?.id || 'default'}/${safeName}`;

        const result = await uploadImageToR2(file, key);

        if (result.success) {
          uploadedImages.push({ url: result.url, name: raw.name, type: mediaType, key });
          successCount++;
        } else {
          console.error('Upload error:', result.error);
          failCount++;
          if (i === 0) {
            setDirectUploadStatus(prev => ({ ...prev, error: `Upload failed: ${result.error}` }));
          }
        }

        setDirectUploadStatus(prev => ({ ...prev, progress: i + 1 }));

        // Save progress every 10 files so interruption doesn't lose all work
        if ((i + 1) % 10 === 0) {
          onProjectUpdate({
            ...currentProject,
            preloadedImages: [...uploadedImages],
            preloadedAt: new Date().toISOString(),
            preloadedSource: 'r2',
          });
        }
      }

      const updatedProject = {
        ...currentProject,
        preloadedImages: uploadedImages,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'r2',
      };
      onProjectUpdate(updatedProject);
      if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);

      setDirectUploadStatus({
        loading: false, progress: selectedFiles.length, total: selectedFiles.length,
        error: failCount > 0 ? `${failCount} file(s) failed to upload.` : null,
        success: `Successfully uploaded ${successCount} file(s) to Cloudflare R2!`,
      });
      setSelectedFiles([]);
    } catch (error) {
      setDirectUploadStatus({ loading: false, progress: 0, total: 0, error: error.message, success: null });
    }
  };

  // ── HuggingFace batch preload ─────────────────────────────────────────────

  const handlePreloadAllImages = async () => {
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    if (!hfConfig.datasetName) {
      setPreloadStatus(prev => ({ ...prev, error: 'Please configure and test dataset connection first.' }));
      return;
    }
    if (!isR2Configured()) {
      setPreloadStatus(prev => ({ ...prev, error: 'Cloudflare R2 is not configured. Please set REACT_APP_R2_PUBLIC_URL and the server-side R2 environment variables.' }));
      return;
    }
    if (!currentProject?.id) {
      setPreloadStatus(prev => ({ ...prev, error: 'No active project. Please select or create a project before preloading images.' }));
      return;
    }

    setPreloadStatus({ loading: true, progress: 0, total: 0, error: null, success: null });

    try {
      // Store HF images under the same per-project R2 prefix used by direct
      // uploads (${userId}/${projectId}/) so they live with the project and
      // get carried over correctly when exporting the project as a template.
      const userId = user?.id || 'anonymous';
      const projectPrefix = `${userId}/${currentProject.id}`;

      // Check which images already exist in R2 for this project
      const existingResult = await listImagesFromR2(`${projectPrefix}/`);
      const existingFileNames = new Set((existingResult.images || []).map(img => img.name));

      // Folder mode (input is "owner/repo/subfolder") returns real file
      // names from the Hub tree, so the rows-mode `image_NNNNNN.jpg` naming
      // and its batch-level "all files already exist → skip the network
      // call entirely" pre-check don't apply. Detect mode up front so the
      // inner loop branches once instead of per-image.
      const datasetSegments = hfConfig.datasetName
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);
      const isFolderMode = datasetSegments.length > 2;

      const countResult = await getImageCountFromDataset(hfConfig.token, hfConfig.datasetName);
      const totalImages = countResult.imageCount || 1000;
      setPreloadStatus(prev => ({ ...prev, total: totalImages }));

      // Collect public URLs for already-existing images
      const allImages = [];
      for (const img of (existingResult.images || [])) {
        allImages.push({ url: img.url, name: img.name, key: img.key, type: img.type || inferMediaType(img.name) });
      }

      const batchSize = 100;
      const batches = Math.ceil(totalImages / batchSize);
      let newCount = 0;
      let skipCount = 0;

      // Sanitize an HF filename so it's safe to use as an R2 key segment.
      // Matches the rule used by the direct-upload path.
      const safeKey = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

      for (let b = 0; b < batches; b++) {
        const offset = b * batchSize;
        const limit = Math.min(batchSize, totalImages - offset);

        if (!isFolderMode) {
          // Rows mode: filenames are deterministic, so we can skip whole
          // batches when every synthesized name already exists in R2.
          const toDownload = [];
          for (let j = 0; j < limit; j++) {
            const padded = String(offset + j).padStart(6, '0');
            if (!existingFileNames.has(`image_${padded}.jpg`)) toDownload.push(offset + j);
          }
          if (!toDownload.length) {
            skipCount += limit;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));
            continue;
          }
        }

        const result = await getImagesFromHuggingFace(hfConfig.token, hfConfig.datasetName, limit, offset);
        if (!result.success || !result.images) throw new Error(result.error || 'Failed to fetch images');

        for (let k = 0; k < result.images.length; k++) {
          const gi = offset + k;
          // Folder mode preserves the original filename from the HF tree
          // (sanitized for R2). Rows mode keeps the existing zero-padded
          // synthetic naming so old projects continue to dedupe correctly.
          const fname = isFolderMode
            ? safeKey(result.images[k].name || `image_${String(gi).padStart(6, '0')}.jpg`)
            : `image_${String(gi).padStart(6, '0')}.jpg`;
          if (existingFileNames.has(fname)) { skipCount++; continue; }

          try {
            // Gated datasets serve their "permanent" image URLs from
            // huggingface.co/datasets/.../resolve/main/... which 401s
            // without an Authorization header. Signed CDN URLs already
            // carry auth in the query string, so we only attach the
            // bearer token when the request actually targets huggingface.co.
            const imgUrl = result.images[k].url;
            const fetchOpts = (hfConfig.token && hfConfig.token.trim() && /^https:\/\/(?:[a-z0-9-]+\.)*huggingface\.co\//i.test(imgUrl))
              ? { headers: { Authorization: `Bearer ${hfConfig.token.trim()}` } }
              : undefined;
            const resp = await fetch(imgUrl, fetchOpts);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            // Run HF-fetched images through the same ≤300KB compressor used
            // for direct uploads, so every R2 object served to participants
            // is on the same size/quality budget regardless of source.
            const wrapped = new File([blob], fname, { type: blob.type || 'image/jpeg' });
            const compressed = await compressImage(wrapped);
            const r2Key = `${projectPrefix}/${fname}`;
            const uploadResult = await uploadImageToR2(compressed, r2Key);
            if (!uploadResult.success) continue;
            // Track the filename we used so a re-run skips it from
            // existingFileNames without an extra R2 list round-trip.
            existingFileNames.add(fname);
            allImages.push({ url: uploadResult.url, name: fname, key: r2Key, type: 'image' });
            newCount++;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));

            // Save progress every 10 new uploads
            if (newCount % 10 === 0) {
              onProjectUpdate({
                ...currentProject,
                preloadedImages: [...allImages],
                preloadedAt: new Date().toISOString(),
                preloadedSource: 'r2',
              });
            }
          } catch {}
        }
      }

      allImages.sort((a, b) => a.name.localeCompare(b.name));
      const updatedProject = {
        ...currentProject,
        preloadedImages: allImages,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'r2',
      };
      onProjectUpdate(updatedProject);

      setPreloadStatus({
        loading: false, progress: allImages.length, total: totalImages, error: null,
        success: `Completed! ${allImages.length} images available (${newCount} new, ${skipCount} skipped).`,
      });
    } catch (error) {
      setPreloadStatus({ loading: false, progress: 0, total: 0, error: error.message, success: null });
    }
  };

  const handleClearImages = async () => {
    if (!currentProject) return;
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const count = currentProject.preloadedImages?.length || 0;
    if (!window.confirm(`Clear all ${count} uploaded images from Cloudflare R2? This cannot be undone.`)) return;

    // Delete files from R2
    if (isR2Configured() && currentProject.preloadedImages?.length > 0) {
      try {
        const userId = user?.id || 'anonymous';
        const projectId = currentProject.id;
        const listResult = await listImagesFromR2(`${userId}/${projectId}`);
        if (listResult.success && listResult.images.length > 0) {
          const keys = listResult.images.map(img => img.key);
          await deleteImagesFromR2(keys);
        }
      } catch (e) {
        console.error('Error clearing images from R2:', e);
      }
    }

    const updatedProject = {
      ...currentProject,
      preloadedImages: [],
      preloadedAt: null,
      preloadedSource: null,
    };
    onProjectUpdate(updatedProject);
    setSelectedMedia(new Set());
    setMediaPage(1);
    if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const preloadedCount = currentProject?.preloadedImages?.length || 0;
  const mediaGroups = useMemo(
    () => analyzeMediaGroups(currentProject?.preloadedImages || []),
    [currentProject?.preloadedImages],
  );
  const groupSummary = useMemo(
    () => summarizeMediaGroupsBySize(currentProject?.preloadedImages || []),
    [currentProject?.preloadedImages],
  );
  const pairedGroups = mediaGroups.filter((g) => g.isGrouped);
  const filteredPairedGroups = useMemo(() => {
    if (groupSizeFilter === 'all') return pairedGroups;
    const n = parseInt(groupSizeFilter, 10);
    return pairedGroups.filter((g) => g.size === n);
  }, [pairedGroups, groupSizeFilter]);
  const mediaCategories = useMemo(
    () => analyzeMediaCategories(currentProject?.preloadedImages || []),
    [currentProject?.preloadedImages],
  );
  const mediaCounts = (currentProject?.preloadedImages || []).reduce((acc, m) => {
    const t = m.type || inferMediaType(m.name || m.url);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, color: 'primary.main' }}>
        Media Dataset
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upload images, videos, and audio to Cloudflare R2. They will be served to survey participants.
        Images over 300 KB are automatically compressed. Video/audio are uploaded as-is (max ~100 MB).
        HuggingFace batch import is available as an optional tool for images.
      </Typography>

      <MediaPairingGuide
        totalFileCount={preloadedCount}
        pairedSetCount={groupSummary.total}
        pairedSetsBySize={groupSummary.bySize}
      />

      <MediaCategoryGuide
        categoryCount={mediaCategories.length}
        totalFileCount={preloadedCount}
        categoryLabels={mediaCategories.map((c) => c.category)}
      />

      {!isR2Configured() && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Cloudflare R2 is not configured. Set <code>REACT_APP_R2_PUBLIC_URL</code> (client) and the
          server-side <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>,{' '}
          <code>R2_SECRET_ACCESS_KEY</code>, <code>R2_BUCKET_NAME</code>, <code>R2_PUBLIC_URL</code>{' '}
          environment variables to enable image uploads.
        </Alert>
      )}

      {/* ── Current Status ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        {r2Syncing ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Checking R2 for existing images…</Typography>
          </Box>
        ) : preloadedCount > 0 ? (
          <>
            <Chip icon={<CheckCircle />} label={`${preloadedCount} media file(s) in R2`} color="success" variant="outlined" />
            {Object.entries(mediaCounts).map(([t, n]) => (
              <Chip key={t} size="small" label={`${n} ${t}`} variant="outlined" />
            ))}
            <Chip label="☁️ Cloudflare R2" color="primary" size="small" variant="outlined" />
            {currentProject?.preloadedAt && (
              <Typography variant="body2" color="text.secondary">
                Last upload: {new Date(currentProject.preloadedAt).toLocaleString()}
              </Typography>
            )}
          </>
        ) : (
          <Chip icon={<Warning />} label="No images uploaded yet" color="default" variant="outlined" />
        )}
      </Box>

      {preloadedCount > 0 && pairedGroups.length > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'info.light' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Detected Media Groups ({pairedGroups.length})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Upload-time pairing preview. Each row is one fixed set that stays together when a question uses
            &quot;Random fixed sets&quot; with a matching <strong>files per set</strong> count.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {Object.entries(groupSummary.bySize)
              .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
              .map(([size, count]) => (
                <Chip
                  key={size}
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`${count} set(s) × ${size} file(s)`}
                />
              ))}
          </Box>
          <FormControl size="small" sx={{ minWidth: 160, mb: 2 }}>
            <InputLabel id="group-size-filter">Filter by set size</InputLabel>
            <Select
              labelId="group-size-filter"
              label="Filter by set size"
              value={groupSizeFilter}
              onChange={(e) => setGroupSizeFilter(e.target.value)}
            >
              <MenuItem value="all">All sizes</MenuItem>
              {Object.keys(groupSummary.bySize)
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                .map((size) => (
                  <MenuItem key={size} value={size}>{size} file(s) per set</MenuItem>
                ))}
            </Select>
          </FormControl>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>Group ID</TableCell>
                  <TableCell align="center">Size</TableCell>
                  <TableCell>Types</TableCell>
                  <TableCell>Files (in slot order)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPairedGroups.slice(0, 50).map((g) => (
                  <TableRow key={g.groupKey} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{g.groupId}</Typography>
                    </TableCell>
                    <TableCell align="center">{g.size}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{g.types.join(' + ')}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace' }}>
                        {g.members.map((m) => m.name).join('  ·  ')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {filteredPairedGroups.length > 50 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Showing first 50 of {filteredPairedGroups.length} groups.
            </Typography>
          )}
          {filteredPairedGroups.length === 0 && (
            <Alert severity="warning" sx={{ mt: 1 }}>No groups match this size filter.</Alert>
          )}
        </Box>
      )}

      {preloadedCount > 0 && mediaCategories.length > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'secondary.light' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Detected Media Categories ({mediaCategories.length})
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Use Survey Builder → Media Assignment → <strong>One per category</strong> to show one random file from each class in every question.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                  <TableCell>Category</TableCell>
                  <TableCell align="center">Files</TableCell>
                  <TableCell>Types</TableCell>
                  <TableCell>Sample filenames</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mediaCategories.map((c) => (
                  <TableRow key={c.category} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{c.category}</Typography>
                    </TableCell>
                    <TableCell align="center">{c.count}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{c.types.join(', ')}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {c.members.slice(0, 4).map((m) => m.name).join(' · ')}
                        {c.count > 4 ? ` · +${c.count - 4} more` : ''}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* ── Import from source template (only when applicable) ── */}
      {sourceTemplate && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'secondary.light' }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ContentCopy fontSize="small" color="secondary" />
            Import Template Images
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This project was created from <strong>{sourceTemplate.name}</strong>,
            which ships with {sourceTemplate.preloadedImages?.length || 0} image
            {sourceTemplate.preloadedImages?.length === 1 ? '' : 's'}.
            Copy them into this project so the survey can run out of the box —
            existing files in your project folder are kept unchanged.
          </Typography>

          {templateImportStatus.loading && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">
                  {templateImportStatus.total > 0
                    ? `Copying template images… (${templateImportStatus.progress}/${templateImportStatus.total})`
                    : 'Listing template images…'}
                </Typography>
                {templateImportStatus.total > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {templateImportStatus.progress} / {templateImportStatus.total}
                  </Typography>
                )}
              </Box>
              <LinearProgress
                variant={templateImportStatus.total > 0 ? 'determinate' : 'indeterminate'}
                value={templateImportStatus.total > 0
                  ? (templateImportStatus.progress / templateImportStatus.total) * 100
                  : undefined}
                sx={{ height: 8, borderRadius: 4 }}
              />
            </Box>
          )}

          {templateImportStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{templateImportStatus.success}</Alert>}
          {templateImportStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{templateImportStatus.error}</Alert>}

          <Button
            variant="contained"
            color="secondary"
            onClick={handleImportFromTemplate}
            disabled={templateImportStatus.loading || !isR2Configured()}
            startIcon={templateImportStatus.loading ? <CircularProgress size={18} color="inherit" /> : <ContentCopy />}
          >
            {templateImportStatus.loading ? 'Importing…' : 'Import Images from Template'}
          </Button>
        </Box>
      )}

      {/* ── Direct Upload ── */}
      <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'primary.light' }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CloudUpload fontSize="small" color="primary" />
          Upload Media to Cloudflare R2
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select image, video, or audio files to upload to Cloudflare R2.
          Images over 300 KB are automatically compressed in your browser before upload.
        </Typography>

        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => setSelectedFiles(Array.from(e.target.files))}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={directUploadStatus.loading}>
            Choose Media Files
          </Button>
          {selectedFiles.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {selectedFiles.length} file(s) selected
            </Typography>
          )}
        </Box>

        {directUploadStatus.loading && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Uploading...</Typography>
              <Typography variant="body2" color="text.secondary">
                {directUploadStatus.progress} / {directUploadStatus.total}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={directUploadStatus.total > 0 ? (directUploadStatus.progress / directUploadStatus.total) * 100 : 0}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}

        {directUploadStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{directUploadStatus.success}</Alert>}
        {directUploadStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{directUploadStatus.error}</Alert>}

        <Button
          variant="contained"
          color="primary"
          onClick={handleDirectUpload}
          disabled={!selectedFiles.length || directUploadStatus.loading || !isR2Configured()}
          startIcon={directUploadStatus.loading ? <CircularProgress size={20} color="inherit" /> : <CloudUpload />}
        >
          Upload {selectedFiles.length > 0 ? `${selectedFiles.length} File(s)` : ''} to R2
        </Button>
      </Box>

      {/* ── Uploaded Media Library ── */}
      {preloadedCount > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Uploaded Media ({preloadedCount})
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={refreshingMedia ? <CircularProgress size={14} /> : <Refresh />}
                onClick={refreshMediaFromR2}
                disabled={refreshingMedia || !isR2Configured()}
              >
                Refresh from R2
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SelectAll />}
                onClick={selectAllFiltered}
                disabled={!filteredMedia.length}
              >
                Select filtered
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Deselect />}
                onClick={clearMediaSelection}
                disabled={!selectedMedia.size}
              >
                Clear selection
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={mediaActionStatus.loading && mediaDownloadProgress ? <CircularProgress size={14} /> : <CloudDownload />}
                onClick={handleDownloadSelectedMedia}
                disabled={!selectedMedia.size || mediaActionStatus.loading}
              >
                Download selected ({selectedMedia.size})
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CloudDownload />}
                onClick={handleDownloadFilteredMedia}
                disabled={!filteredMedia.length || mediaActionStatus.loading}
              >
                Download filtered ({filteredMedia.length})
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<Delete />}
                onClick={handleDeleteSelectedMedia}
                disabled={!selectedMedia.size || mediaActionStatus.loading}
              >
                Delete selected ({selectedMedia.size})
              </Button>
              <Button variant="outlined" color="error" onClick={handleClearImages} startIcon={<Delete />} size="small">
                Clear all
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder="Search by filename…"
              value={mediaSearch}
              onChange={(e) => setMediaSearch(e.target.value)}
              sx={{ minWidth: 220, flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="media-filter-label">Type</InputLabel>
              <Select
                labelId="media-filter-label"
                label="Type"
                value={mediaFilter}
                onChange={(e) => setMediaFilter(e.target.value)}
              >
                <MenuItem value="all">All types</MenuItem>
                <MenuItem value="image">Image</MenuItem>
                <MenuItem value="video">Video</MenuItem>
                <MenuItem value="audio">Audio</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {mediaActionStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{mediaActionStatus.success}</Alert>}
          {mediaActionStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{mediaActionStatus.error}</Alert>}
          {mediaDownloadProgress && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">Downloading…</Typography>
                <Typography variant="body2" color="text.secondary">
                  {mediaDownloadProgress.done} / {mediaDownloadProgress.total}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={(mediaDownloadProgress.done / mediaDownloadProgress.total) * 100}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}

          {filteredMedia.length === 0 ? (
            <Alert severity="info">No media matches your search or filter.</Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Showing {pagedMedia.length} of {filteredMedia.length} file(s)
                {mediaSearch || mediaFilter !== 'all' ? ' (filtered)' : ''}.
                Click a card to select; use download or trash icons on each file.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
                {pagedMedia.map((img) => {
                  const t = img.type || inferMediaType(img.name || img.url);
                  const selected = selectedMedia.has(img.name);
                  return (
                    <Box
                      key={img.key || img.name}
                      sx={{
                        position: 'relative',
                        borderRadius: 1,
                        overflow: 'hidden',
                        border: '2px solid',
                        borderColor: selected ? 'primary.main' : 'divider',
                        bgcolor: 'grey.100',
                        cursor: 'pointer',
                        transition: 'border-color .15s',
                        '&:hover .media-action-btn': { opacity: 1 },
                      }}
                      onClick={() => toggleMediaSelection(img.name)}
                    >
                      <Checkbox
                        size="small"
                        checked={selected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleMediaSelection(img.name)}
                        sx={{ position: 'absolute', top: 2, left: 2, zIndex: 2, bgcolor: 'rgba(255,255,255,0.85)', borderRadius: 1, p: 0.25 }}
                      />
                      <Box sx={{ position: 'absolute', top: 2, right: 2, zIndex: 2, display: 'flex', gap: 0.25 }}>
                        <Tooltip title="Download">
                          <IconButton
                            className="media-action-btn"
                            size="small"
                            color="primary"
                            disabled={mediaActionStatus.loading}
                            onClick={(e) => handleDownloadSingleMedia(img, e)}
                            sx={{
                              bgcolor: 'rgba(255,255,255,0.9)', opacity: 0, transition: 'opacity .15s',
                            }}
                          >
                            <CloudDownload fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            className="media-action-btn"
                            size="small"
                            color="error"
                            disabled={mediaActionStatus.loading}
                            onClick={(e) => { e.stopPropagation(); handleDeleteSingleMedia(img); }}
                            sx={{
                              bgcolor: 'rgba(255,255,255,0.9)', opacity: 0, transition: 'opacity .15s',
                            }}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                      <Box sx={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {t === 'video' ? (
                          <video src={img.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                        ) : t === 'audio' ? (
                          <Typography variant="caption" sx={{ p: 1, textAlign: 'center' }}>🎵 Audio</Typography>
                        ) : (
                          <img
                            src={img.url}
                            alt={img.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        )}
                      </Box>
                      <Box sx={{ p: 1, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" noWrap title={img.name} sx={{ display: 'block' }}>
                          {img.name}
                        </Typography>
                        <Chip size="small" label={t} variant="outlined" sx={{ height: 18, fontSize: '0.65rem', mt: 0.5 }} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
              {totalMediaPages > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                  <Pagination
                    count={totalMediaPages}
                    page={mediaPage}
                    onChange={(_, p) => setMediaPage(p)}
                    color="primary"
                    size="small"
                  />
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      <Divider sx={{ my: 4 }} />

      {/* ── HuggingFace (Optional) ── */}
      <Accordion
        expanded={hfExpanded}
        onChange={(_, v) => setHfExpanded(v)}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              🤗 HuggingFace Dataset Import (Optional)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Batch-import images from a HuggingFace dataset into Cloudflare R2
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" component="div">
              1. <strong>Public datasets:</strong> Leave token empty<br />
              2. <strong>Private datasets:</strong> Get token from{' '}
              <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer">
                HuggingFace Settings → Access Tokens
              </a><br />
              3. Format: <code>owner/dataset</code> for parquet-style datasets
              (e.g. <code>sijiey/Thermal-Affordance-Dataset</code>),
              or <code>owner/dataset/subfolder</code> to import an image folder
              (e.g. <code>Jusba/Greenery_Survey_Helsinki_Mapillary/images</code>)<br />
              4. Enable, save, test connection, then click Preload
            </Typography>
          </Alert>

          {(hfStatus.connected || hfStatus.error) && (
            <Alert severity={hfStatus.connected ? 'success' : 'error'} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {hfStatus.loading ? <CircularProgress size={18} /> : hfStatus.connected ? <CheckCircle /> : <ErrorIcon />}
                <Typography variant="body2">
                  {hfStatus.connected ? 'Connection successful!' : hfStatus.error}
                </Typography>
              </Box>
            </Alert>
          )}

          <Box sx={{ p: 2.5, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', mb: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControlLabel
                control={<Switch checked={hfConfig.enabled} onChange={(e) => setHfConfig(p => ({ ...p, enabled: e.target.checked }))} />}
                label="Enable HuggingFace Dataset Integration"
              />
              <TextField
                fullWidth label="Access Token (optional)" type="password"
                value={hfConfig.token}
                onChange={(e) => setHfConfig(p => ({ ...p, token: e.target.value }))}
                placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxx"
                helperText="Leave empty for public datasets"
                disabled={!hfConfig.enabled} size="small"
              />
              <TextField
                fullWidth label="Dataset Name" value={hfConfig.datasetName}
                onChange={(e) => setHfConfig(p => ({ ...p, datasetName: e.target.value }))}
                placeholder="owner/dataset  or  owner/dataset/subfolder"
                helperText="Use 'owner/dataset' for rows-style data, or 'owner/dataset/subfolder' to import an image folder"
                disabled={!hfConfig.enabled} size="small"
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button variant="contained" size="small" onClick={saveHfConfig} disabled={!hfConfig.enabled || !hfConfig.datasetName}>
                  Save
                </Button>
                <Button variant="outlined" size="small" onClick={testHfConnection}
                  disabled={!hfConfig.enabled || !hfConfig.datasetName || hfStatus.loading}
                  startIcon={hfStatus.loading ? <CircularProgress size={16} /> : <Refresh />}>
                  Test Connection
                </Button>
              </Box>
            </Box>
          </Box>

          {hfStatus.datasetInfo && hfStatus.connected && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>{hfStatus.datasetInfo.id}</strong> — {hfStatus.datasetInfo.imageCount || 0} images found
              </Typography>
            </Alert>
          )}

          {preloadStatus.loading && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">Downloading from HuggingFace → Uploading to Cloudflare R2...</Typography>
                <Typography variant="body2" color="text.secondary">{preloadStatus.progress} / {preloadStatus.total}</Typography>
              </Box>
              <LinearProgress variant="determinate"
                value={preloadStatus.total > 0 ? (preloadStatus.progress / preloadStatus.total) * 100 : 0}
                sx={{ height: 8, borderRadius: 4 }} />
            </Box>
          )}
          {preloadStatus.success && <Alert severity="success" sx={{ mb: 2 }}>{preloadStatus.success}</Alert>}
          {preloadStatus.error && <Alert severity="error" sx={{ mb: 2 }}>{preloadStatus.error}</Alert>}

          <Button
            variant="contained" color="primary"
            onClick={handlePreloadAllImages}
            disabled={!hfStatus.connected || !isR2Configured() || preloadStatus.loading}
            startIcon={preloadStatus.loading ? <CircularProgress size={20} /> : <CloudDownload />}
          >
            {preloadedCount > 0 ? 'Re-preload All Images to R2' : 'Preload All Images to R2'}
          </Button>

          {!hfStatus.connected && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Configure HuggingFace dataset and test connection first.
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>

      {onNextStep && (
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" color="primary" size="large" onClick={onNextStep} sx={{ px: 4, py: 1.5, fontWeight: 600 }}>
            Next: Survey Builder →
          </Button>
        </Box>
      )}
    </Box>
  );
}
