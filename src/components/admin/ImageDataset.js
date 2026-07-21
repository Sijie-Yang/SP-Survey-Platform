import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
  Chip,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Refresh,
  CheckCircle,
  Error as ErrorIcon,
  Warning,
  CloudDownload,
  Delete,
  CloudUpload,
  ContentCopy,
  Search,
  SelectAll,
  Deselect,
  DriveFileMove,
} from '@mui/icons-material';
import {
  testHuggingFaceConnection,
  getImagesFromHuggingFace,
  getImageCountFromDataset,
} from '../../lib/huggingface';
import { isR2Configured, uploadImageToR2, deleteImagesFromR2, listImagesFromR2, copyImagesInR2, projectR2Prefix, stripTemplateOwnedMedia, r2KeyFromUrl, isTemplateR2Key } from '../../lib/r2';
import { asyncPool } from '../../lib/asyncPool';
import { inferMediaType, normalizeMediaEntry, getMediaId, MEDIA_ACCEPT, analyzeTaggedSets, analyzeTaggedCategories, downloadMediaFiles, sortMediaByName, compareMediaNames, buildProjectMediaKey, joinFolderPath, normalizeFolderPath } from '../../lib/mediaUtils';
import MediaPairingGuide from './MediaPairingGuide';
import MediaCategoryGuide from './MediaCategoryGuide';
import MediaFolderBrowser from './MediaFolderBrowser';
import SpatialIntelligencePanel from './SpatialIntelligencePanel';
import MediaPreannotatePanel from './MediaPreannotatePanel';
import MediaPreannotateResults from './MediaPreannotateResults';
import ConfirmDialog from '../layout/ConfirmDialog';
import { AdminPageHeader } from './AdminPageLayout';
import { L0_MODEL } from '../../lib/imageFeaturesL0';
import { SEG_MODEL } from '../../lib/falInference';
import {
  loadFeaturesMapFromR2,
  featureStatusFromMap,
  copyFeatureCsvsTemplateToProject,
  migrateLegacyFeaturesToR2,
  FEATURE_MODELS,
  SAM_PREANNOT_MODEL,
} from '../../lib/imageFeaturesR2';
import { featureStorageKey } from '../../lib/imageFeaturesStore';
import { getTemplateById, listTemplates } from '../../lib/templateManager';
import {
  computeTemplateImportProgress,
  buildTemplateCopyTodo,
  mergeCopiedIntoProjectImages,
  getTemplateImportHistory,
  mergeTemplateImportHistory,
  mergeTemplateMediaFoldersIntoProject,
  formatTemplateImportStatus,
  formatTemplateImportButtonLabel,
  PREVIEW_MEDIA_IMPORT_ID,
  isPreviewMediaImportId,
} from '../../lib/templateImageImport';
import { SKILL_PREVIEW_PREFIX } from '../../lib/skillPreviewMedia';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import { useAuth } from '../../contexts/AuthContext';

const MEDIA_PAGE_SIZE = 24;
/** Images per R2 copy API request. */
const R2_COPY_REQUEST_BATCH = 100;
/** How many copy requests run in parallel (up to BATCH × CONCURRENCY objects in flight). */
const R2_COPY_CONCURRENCY = 3;

function templateImportProgressLabel(status) {
  if (status.phase === 'listing') {
    return isPreviewMediaImportId(status.activeTemplateId)
      ? 'Scanning preview media library & project folders…'
      : 'Scanning template & project folders…';
  }
  if (status.phase === 'features') return 'Copying feature CSVs (optional metadata)…';
  if (status.phase === 'saving') return 'Saving project image list to database…';
  if (status.total === 0 && status.phase !== 'idle') {
    return status.activeTemplateName
      ? `All media from "${status.activeTemplateName}" are already in this project.`
      : 'All source media are already in this project.';
  }
  const shown = Math.min(status.progress, status.total);
  const pct = status.total > 0 ? Math.round((shown / status.total) * 100) : 0;
  let label = status.activeTemplateName
    ? `Importing "${status.activeTemplateName}": ${shown} / ${status.total} (${pct}%)`
    : `Copying ${shown} / ${status.total} (${pct}%)`;
  if (status.skipped > 0) label += ` · ${status.skipped} skipped (already present)`;
  return label;
}

/** Copy template images — progress ticks +1 each time the server finishes one file. */
async function copyTemplateImagesWithRealProgress(todo, setStatus) {
  const batches = [];
  for (let i = 0; i < todo.length; i += R2_COPY_REQUEST_BATCH) {
    batches.push(todo.slice(i, i + R2_COPY_REQUEST_BATCH));
  }

  const copiedImages = [];
  const errors = [];
  const progressRef = { current: 0 };

  await asyncPool(R2_COPY_CONCURRENCY, batches, async (batch) => {
    const res = await copyImagesInR2(batch, {
      onProgress: () => {
        progressRef.current += 1;
        const done = progressRef.current;
        setStatus((prev) => ({
          ...prev,
          progress: done,
          phase: 'copying',
        }));
      },
    });
    if (res.copied?.length) copiedImages.push(...res.copied);
    if (res.errors?.length) errors.push(...res.errors);
    return res;
  });

  return { copiedImages, errors, completed: progressRef.current };
}

function mediaEntryKey(entry, userId, projectId) {
  const prefix = projectR2Prefix(userId, projectId);
  if (!prefix) return null;

  // Only delete objects that live under THIS project. Template keys/URLs must
  // never be deleted from the project media UI.
  if (entry?.key) {
    if (entry.key.startsWith(prefix)) return entry.key;
    if (isTemplateR2Key(entry.key)) return null;
  }
  const fromUrl = r2KeyFromUrl(entry?.url);
  if (fromUrl) {
    if (fromUrl.startsWith(prefix)) return fromUrl;
    if (isTemplateR2Key(fromUrl)) return null;
  }
  if (!entry?.name) return null;
  // Nested folders must keep their relative path; basename-only keys collide.
  return buildProjectMediaKey(prefix, entry.folder || '', entry.name);
}

function mediaEntryIdentity(entry, userId, projectId) {
  return getMediaId(entry)
    || mediaEntryKey(entry, userId, projectId)
    || entry?.url
    || entry?.name
    || null;
}

export default function ImageDataset({ currentProject, onProjectUpdate, onConfigChange, onNextStep }) {
  const { t } = useRegion();
  const { user } = useAuth();

  // Direct upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [directUploadStatus, setDirectUploadStatus] = useState({
    loading: false, progress: 0, total: 0, error: null, success: null,
  });
  const fileInputRef = useRef(null);

  // HuggingFace optional section
  const [hfConfig, setHfConfig] = useState({ enabled: false, token: '', datasetName: '' });
  const [hfStatus, setHfStatus] = useState({ loading: false, connected: false, error: null, datasetInfo: null });
  const [preloadStatus, setPreloadStatus] = useState({ loading: false, progress: 0, total: 0, error: null, success: null });

  // R2 sync state
  const [r2Syncing, setR2Syncing] = useState(false);

  // Import template images — any project can pull from any template with an R2 folder,
  // or from the shared admin preview media library (skill-preview/).
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [previewMediaCount, setPreviewMediaCount] = useState(0);
  const [templateProgressMap, setTemplateProgressMap] = useState({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateImportStatus, setTemplateImportStatus] = useState({
    loading: false,
    progress: 0,
    total: 0,
    templateTotal: 0,
    skipped: 0,
    phase: 'idle', // idle | listing | copying | features | saving
    activeTemplateId: null,
    activeTemplateName: null,
    error: null,
    success: null,
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
  const [featureInspect, setFeatureInspect] = useState(null); // { name, mediaId, records }
  const [r2FeatureMap, setR2FeatureMap] = useState({});
  const [preannotateFocusName, setPreannotateFocusName] = useState(null);
  /** Latest autosave → patch Pre-annotate results without re-fetching the library. */
  const [preannotateSavedPatch, setPreannotateSavedPatch] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // { title, message, onConfirm }
  const [currentFolder, setCurrentFolder] = useState('');
  const [openMoveSignal, setOpenMoveSignal] = useState(0);

  const userId = user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const projectPrefix = projectId ? `${userId}/${projectId}/` : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectPrefix || !isR2Configured()) {
        setR2FeatureMap({});
        return;
      }
      try {
        const legacy = currentProject?.imageDatasetConfig?.imageFeatures;
        if (legacy && Object.keys(legacy).length) {
          await migrateLegacyFeaturesToR2(projectPrefix, legacy);
        }
        const map = await loadFeaturesMapFromR2(projectPrefix, FEATURE_MODELS);
        if (!cancelled) setR2FeatureMap(map);
      } catch (err) {
        console.warn('loadFeaturesMapFromR2', err);
      }
    })();
    return () => { cancelled = true; };
  }, [projectPrefix, currentProject?.preloadedImages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalizeR2Listing = (images = []) => sortMediaByName(images.map((img) => normalizeMediaEntry({
    url: img.url,
    name: img.name,
    key: img.key,
    folder: img.folder,
    type: img.type || inferMediaType(img.name),
    media_id: img.media_id || img.key,
  }, projectPrefix)));

  // Strip accidental template-owned URLs/keys from project media list.
  // (Legacy bug: create-from-template copied template refs into preloadedImages.)
  useEffect(() => {
    const imgs = currentProject?.preloadedImages;
    if (!imgs?.length || !onProjectUpdate) return;
    const cleaned = stripTemplateOwnedMedia(imgs);
    if (cleaned.length === imgs.length) return;
    console.warn(
      `Removed ${imgs.length - cleaned.length} template-owned media ref(s) from project ${currentProject.id}`,
    );
    onProjectUpdate({
      ...currentProject,
      preloadedImages: cleaned,
      preloadedAt: cleaned.length ? currentProject.preloadedAt : null,
      preloadedSource: cleaned.length ? currentProject.preloadedSource : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id, currentProject?.preloadedImages?.length]);

  // Backfill media_id on legacy preloadedImages entries
  useEffect(() => {
    const imgs = currentProject?.preloadedImages;
    if (!imgs?.length || !onProjectUpdate) return;
    let changed = false;
    const next = imgs.map((raw) => {
      const n = normalizeMediaEntry(raw);
      if (!n) return raw;
      if (raw.media_id === n.media_id && raw.type === n.type) return raw;
      changed = true;
      return { ...raw, media_id: n.media_id, type: n.type || raw.type };
    });
    if (changed) {
      onProjectUpdate({ ...currentProject, preloadedImages: next });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run when project id / image count changes
  }, [currentProject?.id, currentProject?.preloadedImages?.length]);

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
      if (!result.success) {
        if (result.unreachable || /load failed|failed to fetch|unreachable/i.test(result.error || '')) {
          setMediaActionStatus({
            loading: false,
            error: 'Could not refresh the R2 file list (API proxy unreachable). Saved media is unchanged.',
            success: null,
          });
          return;
        }
        throw new Error(result.error || 'Failed to list media from R2');
      }
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
    setConfirmDialog({
      title: 'Delete media',
      message: `Delete ${label} from Cloudflare R2? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        setMediaActionStatus({ loading: true, error: null, success: null });
        try {
          if (isR2Configured()) {
            const keys = entries
              .map((entry) => mediaEntryKey(entry, userId, projectId))
              .filter(Boolean);
            if (keys.length) {
              const del = await deleteImagesFromR2(keys, {
                allowedPrefix: projectR2Prefix(userId, projectId),
              });
              if (!del.success) throw new Error(del.error || 'Failed to delete from R2');
            }
          }

          const removeIds = new Set(
            entries.map((entry) => mediaEntryIdentity(entry, userId, projectId)).filter(Boolean),
          );
          const remaining = (currentProject.preloadedImages || []).filter((m) => {
            const id = mediaEntryIdentity(m, userId, projectId);
            return !id || !removeIds.has(id);
          });
          persistPreloadedImages(remaining);
          setSelectedMedia((prev) => {
            const next = new Set(prev);
            entries.forEach((entry) => {
              if (entry?.name) next.delete(entry.name);
            });
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
      },
    });
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
    const folder = currentFolder || '';
    const filtered = (currentProject?.preloadedImages || []).filter((m) => {
      const entry = normalizeMediaEntry(m, projectPrefix);
      if ((entry.folder || '') !== folder) return false;
      const t = entry.type || inferMediaType(entry.name || entry.url);
      if (mediaFilter !== 'all' && t !== mediaFilter) return false;
      if (q && !(entry.name || '').toLowerCase().includes(q)
        && !(entry.folder || '').toLowerCase().includes(q)) return false;
      return true;
    });
    return sortMediaByName(filtered);
  }, [currentProject?.preloadedImages, mediaSearch, mediaFilter, currentFolder, projectPrefix]);

  /** Images available for SAM pre-annotate (respects gallery filter/search). */
  const preannotateImages = useMemo(
    () => filteredMedia.filter((m) => (m.type || inferMediaType(m.name || m.url)) === 'image'),
    [filteredMedia],
  );

  const preannotateIndex = useMemo(() => {
    if (!preannotateFocusName) return 0;
    const idx = preannotateImages.findIndex((m) => m.name === preannotateFocusName);
    return idx >= 0 ? idx : 0;
  }, [preannotateImages, preannotateFocusName]);

  const preannotateEntry = preannotateImages[preannotateIndex] || null;

  const preannotScrollLockRef = useRef(null); // { top: number } panel viewport top before nav

  const focusMediaInGallery = useCallback((name) => {
    if (!name) return;
    const panel = document.getElementById('media-preannotate-panel');
    if (panel) {
      preannotScrollLockRef.current = { top: panel.getBoundingClientRect().top };
    } else {
      preannotScrollLockRef.current = { top: null, y: window.scrollY };
    }
    setPreannotateFocusName(name);
    setSelectedMedia(new Set([name]));
    const idxInFiltered = filteredMedia.findIndex((m) => m.name === name);
    if (idxInFiltered >= 0) {
      setMediaPage(Math.floor(idxInFiltered / MEDIA_PAGE_SIZE) + 1);
    }
  }, [filteredMedia]);

  useLayoutEffect(() => {
    const lock = preannotScrollLockRef.current;
    if (!lock) return;
    preannotScrollLockRef.current = null;
    const panel = document.getElementById('media-preannotate-panel');
    if (panel && typeof lock.top === 'number') {
      const delta = panel.getBoundingClientRect().top - lock.top;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
      return;
    }
    if (typeof lock.y === 'number') window.scrollTo(0, lock.y);
  }, [preannotateFocusName, mediaPage, selectedMedia]);

  // Keep focus valid when filter/list changes
  useEffect(() => {
    if (!preannotateImages.length) {
      setPreannotateFocusName(null);
      return;
    }
    if (!preannotateFocusName || !preannotateImages.some((m) => m.name === preannotateFocusName)) {
      setPreannotateFocusName(preannotateImages[0].name);
    }
  }, [preannotateImages, preannotateFocusName]);

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

  /** Card click: focus for pre-annotate (images) + select; multi-select via checkbox. */
  const handleMediaCardClick = (img) => {
    const t = img.type || inferMediaType(img.name || img.url);
    if (t === 'image') {
      focusMediaInGallery(img.name);
      return;
    }
    toggleMediaSelection(img.name);
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

  const templateImportHistory = useMemo(
    () => getTemplateImportHistory(currentProject),
    [currentProject?.imageDatasetConfig?.templateImportHistory],
  );

  const refreshTemplateProgress = async (templateIds) => {
    if (!projectId || !isR2Configured() || !templateIds?.length) return;
    const uid = user?.id || 'anonymous';
    const entries = await Promise.all(
      templateIds.map(async (id) => {
        const progress = await computeTemplateImportProgress(id, uid, projectId);
        return [id, progress];
      }),
    );
    setTemplateProgressMap((prev) => {
      const next = { ...prev };
      entries.forEach(([id, progress]) => { next[id] = progress; });
      return next;
    });
  };

  // Load templates that ship with images (any project can import from them).
  // Also keep the shared preview media library selectable as a source.
  useEffect(() => {
    let cancelled = false;
    setLoadingTemplates(true);
    Promise.all([
      listTemplates(user?.id),
      isR2Configured()
        ? listImagesFromR2(SKILL_PREVIEW_PREFIX).then((r) => (
          r.success
            ? (r.images || []).filter((img) => {
              const key = String(img.key || img.name || '');
              return !key.includes('/features/') && !key.includes('/preannotations/');
            }).length
            : 0
        )).catch(() => 0)
        : Promise.resolve(0),
    ]).then(([templates, previewCount]) => {
      if (cancelled) return;
      const withImages = templates.filter(
        (t) => Array.isArray(t.preloadedImages) && t.preloadedImages.length > 0,
      );
      setAvailableTemplates(withImages);
      setPreviewMediaCount(previewCount);
      setSelectedTemplateId((prev) => {
        if (prev === PREVIEW_MEDIA_IMPORT_ID && previewCount > 0) return prev;
        if (prev && withImages.some((t) => t.id === prev)) return prev;
        if (currentProject?.templateId && withImages.some((t) => t.id === currentProject.templateId)) {
          return currentProject.templateId;
        }
        if (withImages[0]?.id) return withImages[0].id;
        return previewCount > 0 ? PREVIEW_MEDIA_IMPORT_ID : '';
      });
    }).finally(() => {
      if (!cancelled) setLoadingTemplates(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, currentProject?.templateId]);

  // Refresh import progress only for templates the user actually imported
  // (plus the currently selected one). Do not scan every catalog template —
  // shared filenames would falsely look like multi-template imports.
  useEffect(() => {
    const ids = new Set(Object.keys(templateImportHistory));
    if (selectedTemplateId) ids.add(selectedTemplateId);
    if (ids.size && projectId) refreshTemplateProgress([...ids]);
    // Do not depend on preloadedImages.length — import already updates progress locally;
    // re-listing R2 after every large save made the UI feel stuck/slow.
  }, [selectedTemplateId, projectId, Object.keys(templateImportHistory).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIsPreviewMedia = isPreviewMediaImportId(selectedTemplateId);
  const selectedTemplate = selectedIsPreviewMedia
    ? null
    : (availableTemplates.find((t) => t.id === selectedTemplateId) || null);
  const selectedProgress = templateProgressMap[selectedTemplateId];
  const selectedImportHistory = templateImportHistory[selectedTemplateId] || null;
  const hasImportSources = availableTemplates.length > 0 || previewMediaCount > 0;

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

  // ── Import images from source template or preview media library ──────────

  const handleImportFromTemplate = async (templateIdOverride) => {
    const templateId = templateIdOverride || selectedTemplateId;
    if (!templateId || !currentProject?.id) return;
    if (!isR2Configured()) {
      setTemplateImportStatus((prev) => ({
        ...prev,
        error: 'Cloudflare R2 is not configured. Please set REACT_APP_R2_PUBLIC_URL and the server-side R2 environment variables.',
      }));
      return;
    }
    if (templateImportStatus.loading) return;

    const fromPreview = isPreviewMediaImportId(templateId);
    let template = null;
    if (fromPreview) {
      template = {
        id: PREVIEW_MEDIA_IMPORT_ID,
        name: 'Preview media library',
        imageDatasetConfig: {},
      };
    } else {
      template = availableTemplates.find((t) => t.id === templateId)
        || (await getTemplateById(templateId));
      if (!template) {
        setTemplateImportStatus((prev) => ({ ...prev, error: 'Template not found.' }));
        return;
      }
    }

    const sourcePrefix = fromPreview
      ? SKILL_PREVIEW_PREFIX
      : `templates/${template.id}/`;

    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const r2PublicUrl = (process.env.REACT_APP_R2_PUBLIC_URL || '').replace(/\/$/, '');
    const uid = user?.id || 'anonymous';
    const projectPrefix = `${uid}/${currentProject.id}/`;

    setTemplateImportStatus({
      loading: true,
      progress: 0,
      total: 0,
      templateTotal: 0,
      skipped: 0,
      phase: 'listing',
      activeTemplateId: template.id,
      activeTemplateName: template.name,
      error: null,
      success: null,
    });

    try {
      const progress = await computeTemplateImportProgress(template.id, uid, currentProject.id);
      if (progress.error) throw new Error(progress.error);

      // Record that this import was started (enables Resume after interrupt).
      // Filename overlap alone is not enough to attribute files to a source.
      const startHistoryEntry = {
        templateName: template.name,
        totalInTemplate: progress.totalInTemplate,
        importedCount: progress.importedCount,
        remaining: progress.remaining,
        isComplete: progress.isComplete,
        lastImportAt: new Date().toISOString(),
        lastBatchCopied: 0,
      };
      const startConfig = mergeTemplateImportHistory(currentProject, template.id, startHistoryEntry);
      // Keep UI/history in sync without a full Supabase write (avoids double-saving large image lists).
      onProjectUpdate({
        ...currentProject,
        imageDatasetConfig: startConfig,
      }, { skipSave: true });
      if (onConfigChange) onConfigChange(true, startConfig);

      const listed = { success: true, images: progress.templateImages };
      const existingImages = progress.existingImages || [];

      if (listed.images.length === 0) {
        setTemplateImportStatus({
          loading: false,
          progress: 0,
          total: 0,
          templateTotal: 0,
          skipped: 0,
          phase: 'idle',
          activeTemplateId: template.id,
          activeTemplateName: template.name,
          error: null,
          success: fromPreview
            ? 'Preview media library is empty.'
            : `"${template.name}" has no images in its template folder.`,
        });
        return;
      }

      const todo = buildTemplateCopyTodo(
        listed.images,
        progress.existingPaths || progress.existingNames,
        projectPrefix,
        sourcePrefix,
      );
      const total = todo.length;
      const skipCount = listed.images.length - total;

      setTemplateImportStatus((prev) => ({
        ...prev,
        templateTotal: listed.images.length,
        skipped: skipCount,
        total,
        progress: 0,
        phase: total > 0 ? 'copying' : (fromPreview ? 'saving' : 'features'),
      }));

      const copiedImages = [];
      const errors = [];
      if (total > 0) {
        const copyResult = await copyTemplateImagesWithRealProgress(todo, setTemplateImportStatus);
        copiedImages.push(...copyResult.copiedImages);
        errors.push(...copyResult.errors);
      }

      const finalImages = mergeCopiedIntoProjectImages(
        existingImages,
        copiedImages,
        r2PublicUrl,
        projectPrefix,
      );

      // Derive progress locally — avoid another full R2 list of source + project.
      const importedCount = Math.min(
        listed.images.length,
        skipCount + copiedImages.length,
      );
      const remaining = Math.max(0, listed.images.length - importedCount);
      const afterProgress = {
        totalInTemplate: listed.images.length,
        importedCount,
        remaining,
        isComplete: listed.images.length > 0 && remaining === 0,
        hasStarted: importedCount > 0,
        error: null,
      };

      if (!fromPreview) {
        setTemplateImportStatus((prev) => ({
          ...prev,
          phase: 'features',
          progress: copiedImages.length,
        }));

        // Copy L0/Seg feature CSVs from template → project (remap media_id by filename)
        try {
          const nameToNewMediaId = new Map();
          finalImages.forEach((img) => {
            const entry = normalizeMediaEntry(img);
            if (entry?.name) nameToNewMediaId.set(entry.name, getMediaId(entry));
          });
          await copyFeatureCsvsTemplateToProject({
            templatePrefix: sourcePrefix,
            projectPrefix,
            nameToNewMediaId,
          });
          const featMap = await loadFeaturesMapFromR2(projectPrefix, FEATURE_MODELS);
          setR2FeatureMap(featMap);
        } catch (featErr) {
          console.warn('Feature CSV copy skipped/failed:', featErr);
        }
      }

      const historyEntry = {
        templateName: template.name,
        totalInTemplate: afterProgress.totalInTemplate,
        importedCount: afterProgress.importedCount,
        remaining: afterProgress.remaining,
        isComplete: afterProgress.isComplete,
        lastImportAt: new Date().toISOString(),
        lastBatchCopied: copiedImages.length,
      };

      let updatedImageDatasetConfig = mergeTemplateImportHistory(
        { ...currentProject, imageDatasetConfig: startConfig },
        template.id,
        historyEntry,
      );
      if (!fromPreview) {
        updatedImageDatasetConfig = mergeTemplateMediaFoldersIntoProject(
          updatedImageDatasetConfig,
          template.imageDatasetConfig || {},
        );
      }

      setTemplateProgressMap((prev) => ({
        ...prev,
        [template.id]: afterProgress,
      }));
      if (fromPreview) {
        setPreviewMediaCount(afterProgress.totalInTemplate);
      }

      setTemplateImportStatus((prev) => ({
        ...prev,
        phase: 'saving',
        progress: copiedImages.length,
      }));

      // One full project write (image list can be large — this is the slow DB step).
      await onProjectUpdate({
        ...currentProject,
        preloadedImages: finalImages,
        preloadedSource: 'r2',
        preloadedAt: new Date().toISOString(),
        imageDatasetConfig: updatedImageDatasetConfig,
      });
      if (onConfigChange) onConfigChange(true, updatedImageDatasetConfig);

      const newCount = copiedImages.length;
      const unit = fromPreview ? 'file' : 'image';
      setTemplateImportStatus({
        loading: false,
        progress: total,
        total,
        templateTotal: listed.images.length,
        skipped: skipCount,
        phase: 'idle',
        activeTemplateId: template.id,
        activeTemplateName: template.name,
        error: errors.length ? `${errors.length} file(s) failed to copy.` : null,
        success: total === 0
          ? `All ${listed.images.length} ${unit}(s) from "${template.name}" are already in this project.`
          : `Imported ${newCount} ${unit}${newCount === 1 ? '' : 's'} from "${template.name}"${skipCount > 0 ? ` (${skipCount} already present — resume supported)` : ''}.`,
      });
    } catch (err) {
      setTemplateImportStatus({
        loading: false,
        progress: 0,
        total: 0,
        templateTotal: 0,
        skipped: 0,
        phase: 'idle',
        activeTemplateId: template?.id || null,
        activeTemplateName: template?.name || null,
        error: err.message,
        success: null,
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
        const key = buildProjectMediaKey(
          `${userId}/${currentProject?.id || 'default'}/`,
          currentFolder,
          safeName,
        );

        const result = await uploadImageToR2(file, key);

        if (result.success) {
          uploadedImages.push({
            url: result.url,
            name: raw.name,
            type: mediaType,
            key,
            media_id: key,
            folder: currentFolder || '',
          });
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
      // Track full relative keys (folder/name) so nested HF folders don't collide.
      const existingKeys = new Set(
        (existingResult.images || []).map((img) => {
          const entry = normalizeMediaEntry(img, `${projectPrefix}/`);
          const folder = entry.folder || '';
          return folder ? `${folder}/${entry.name}` : entry.name;
        }),
      );

      const datasetNameTrimmed = hfConfig.datasetName.trim();
      const datasetSegments = datasetNameTrimmed
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);
      const isFolderMode = datasetSegments.length > 2;

      // Keep HF import destination stable across resume so nested HF folders
      // are not re-prefixed with the current Media library folder (which would
      // create street/street after you open street and click Preload again).
      const prevCfg = currentProject.imageDatasetConfig || {};
      const sameHfTarget = prevCfg.hfImportDataset === datasetNameTrimmed
        && Object.prototype.hasOwnProperty.call(prevCfg, 'hfImportBase');
      const importBase = sameHfTarget
        ? normalizeFolderPath(prevCfg.hfImportBase || '')
        : normalizeFolderPath(currentFolder || '');

      const countResult = await getImageCountFromDataset(hfConfig.token, datasetNameTrimmed);
      const totalImages = countResult.imageCount || 1000;
      setPreloadStatus(prev => ({ ...prev, total: totalImages }));

      // Collect public URLs for already-existing images
      const allImages = [];
      for (const img of (existingResult.images || [])) {
        const entry = normalizeMediaEntry(img, `${projectPrefix}/`);
        allImages.push({
          url: entry.url || img.url,
          name: entry.name,
          key: entry.key || img.key,
          media_id: entry.media_id || entry.key || img.key,
          folder: entry.folder || '',
          type: entry.type || inferMediaType(entry.name),
        });
      }

      const batchSize = 100;
      const batches = Math.ceil(totalImages / batchSize);
      let newCount = 0;
      let skipCount = 0;
      let failCount = 0;
      let lastFailReason = null;
      const importedFolders = new Set(
        (prevCfg.mediaFolders || []).map(normalizeFolderPath).filter(Boolean),
      );

      // Sanitize an HF filename so it's safe to use as an R2 key segment.
      // Matches the rule used by the direct-upload path.
      const safeKey = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeFolderSeg = (seg) => String(seg || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeFolderPath = (folder) => normalizeFolderPath(
        String(folder || '')
          .split('/')
          .map(safeFolderSeg)
          .filter(Boolean)
          .join('/'),
      );

      // Only attach the HF bearer token to Hub resolve URLs that actually
      // need it (gated datasets). Signed CDN / datasets-server cached-asset
      // URLs already carry auth in the query string — adding Authorization
      // forces a CORS preflight that CloudFront rejects with 403, so every
      // download fails with "Failed to fetch" in the browser.
      const fetchOptsForHfImage = (imgUrl) => {
        const token = hfConfig.token && hfConfig.token.trim();
        if (!token || !imgUrl) return undefined;
        if (/[?&](?:Expires|Signature|Key-Pair-Id)=/i.test(imgUrl)) return undefined;
        if (/datasets-server\.huggingface\.co/i.test(imgUrl)) return undefined;
        if (!/^https:\/\/(?:[a-z0-9-]+\.)*huggingface\.co\//i.test(imgUrl)) return undefined;
        return { headers: { Authorization: `Bearer ${token}` } };
      };

      for (let b = 0; b < batches; b++) {
        const offset = b * batchSize;
        const limit = Math.min(batchSize, totalImages - offset);

        if (!isFolderMode) {
          // Rows mode: filenames are deterministic, so we can skip whole
          // batches when every synthesized name already exists in R2.
          const toDownload = [];
          for (let j = 0; j < limit; j++) {
            const padded = String(offset + j).padStart(6, '0');
            if (!existingKeys.has(`image_${padded}.jpg`)) toDownload.push(offset + j);
          }
          if (!toDownload.length) {
            skipCount += limit;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));
            continue;
          }
        }

        const result = await getImagesFromHuggingFace(hfConfig.token, datasetNameTrimmed, limit, offset);
        if (!result.success || !result.images) throw new Error(result.error || 'Failed to fetch images');
        if (!result.images.length) {
          failCount += limit;
          lastFailReason = `HuggingFace returned 0 images for offset ${offset}`;
          continue;
        }

        for (let k = 0; k < result.images.length; k++) {
          const gi = offset + k;
          const hfImg = result.images[k];
          // Folder mode: HF nested paths relative to dataset path, under a
          // stable importBase (not live currentFolder — avoids resume nesting).
          const relFolder = isFolderMode
            ? safeFolderPath(joinFolderPath(importBase, hfImg.relativeFolder || ''))
            : normalizeFolderPath(importBase);
          const fname = isFolderMode
            ? safeKey(hfImg.name || `image_${String(gi).padStart(6, '0')}.jpg`)
            : `image_${String(gi).padStart(6, '0')}.jpg`;
          const relKey = relFolder ? `${relFolder}/${fname}` : fname;
          if (existingKeys.has(relKey)) { skipCount++; continue; }

          try {
            const imgUrl = hfImg.url;
            if (!imgUrl) {
              failCount++;
              lastFailReason = `Missing image URL for ${relKey}`;
              continue;
            }
            const resp = await fetch(imgUrl, fetchOptsForHfImage(imgUrl));
            if (!resp.ok) {
              failCount++;
              lastFailReason = `Download HTTP ${resp.status} for ${relKey}`;
              continue;
            }
            const blob = await resp.blob();
            // datasets-server often serves images as binary/octet-stream;
            // normalize so R2/content-type and the compressor stay consistent.
            const mime = (blob.type && blob.type !== 'binary/octet-stream')
              ? blob.type
              : 'image/jpeg';
            // Run HF-fetched images through the same ≤300KB compressor used
            // for direct uploads, so every R2 object served to participants
            // is on the same size/quality budget regardless of source.
            const wrapped = new File([blob], fname, { type: mime });
            const compressed = await compressImage(wrapped);
            const r2Key = buildProjectMediaKey(`${projectPrefix}/`, relFolder, fname);
            const uploadResult = await uploadImageToR2(compressed, r2Key);
            if (!uploadResult.success) {
              failCount++;
              lastFailReason = uploadResult.error || `R2 upload failed for ${relKey}`;
              continue;
            }
            // Track the key we used so a re-run skips it without an extra R2 list.
            existingKeys.add(relKey);
            if (relFolder) importedFolders.add(relFolder);
            allImages.push({
              url: uploadResult.url,
              name: fname,
              key: r2Key,
              media_id: r2Key,
              folder: relFolder,
              type: 'image',
            });
            newCount++;
            setPreloadStatus(prev => ({ ...prev, progress: allImages.length }));

            // Save progress every 10 new uploads
            if (newCount % 10 === 0) {
              onProjectUpdate({
                ...currentProject,
                preloadedImages: [...allImages],
                preloadedAt: new Date().toISOString(),
                preloadedSource: 'r2',
                imageDatasetConfig: {
                  ...(currentProject.imageDatasetConfig || {}),
                  mediaFolders: [...importedFolders].sort(compareMediaNames),
                  hfImportDataset: datasetNameTrimmed,
                  hfImportBase: importBase,
                },
              });
            }
          } catch (err) {
            failCount++;
            lastFailReason = err?.message || String(err);
            console.error('HF preload image failed:', relKey, err);
          }
        }
      }

      allImages.sort((a, b) => compareMediaNames(a.name, b.name));
      const updatedProject = {
        ...currentProject,
        preloadedImages: allImages,
        preloadedAt: new Date().toISOString(),
        preloadedSource: 'r2',
        imageDatasetConfig: {
          ...(currentProject.imageDatasetConfig || {}),
          mediaFolders: [...importedFolders].sort(compareMediaNames),
          hfImportDataset: datasetNameTrimmed,
          hfImportBase: importBase,
        },
      };
      onProjectUpdate(updatedProject);

      const failNote = failCount > 0
        ? ` ${failCount} failed${lastFailReason ? ` (last: ${lastFailReason})` : ''}.`
        : '';
      if (newCount === 0 && failCount > 0 && allImages.length === 0) {
        setPreloadStatus({
          loading: false, progress: 0, total: totalImages, success: null,
          error: `Preload finished with 0 images uploaded (${failCount} failed).${lastFailReason ? ` Last error: ${lastFailReason}` : ''}`,
        });
      } else {
        setPreloadStatus({
          loading: false, progress: allImages.length, total: totalImages, error: null,
          success: `Completed! ${allImages.length} images available (${newCount} new, ${skipCount} skipped).${
            isFolderMode && importedFolders.size ? ` ${importedFolders.size} folder(s) preserved.` : ''
          }${failNote}`,
        });
      }
    } catch (error) {
      setPreloadStatus({ loading: false, progress: 0, total: 0, error: error.message, success: null });
    }
  };

  const handleClearImages = async () => {
    if (!currentProject) return;
    scrollRef.current = window.scrollY;
    restoreScrollRef.current = true;

    const count = currentProject.preloadedImages?.length || 0;
    setConfirmDialog({
      title: 'Clear all media',
      message: `Clear all ${count} uploaded images from Cloudflare R2? This cannot be undone.`,
      confirmLabel: 'Clear all',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        if (isR2Configured() && currentProject.preloadedImages?.length > 0) {
          try {
            const uid = user?.id || 'anonymous';
            const pid = currentProject.id;
            const prefix = projectR2Prefix(uid, pid);
            const listResult = await listImagesFromR2(prefix);
            if (listResult.success && listResult.images.length > 0) {
              const keys = listResult.images
                .map((img) => img.key)
                .filter((key) => key && key.startsWith(prefix));
              await deleteImagesFromR2(keys, { allowedPrefix: prefix });
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
          imageDatasetConfig: {
            ...(currentProject.imageDatasetConfig || {}),
            mediaFolderTags: {},
            mediaFolders: [],
          },
        };
        onProjectUpdate(updatedProject);
        setSelectedMedia(new Set());
        setMediaPage(1);
        if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const preloadedCount = currentProject?.preloadedImages?.length || 0;
  const featureStatusByName = useMemo(() => {
    const map = new Map();
    (currentProject?.preloadedImages || []).forEach((raw) => {
      const entry = normalizeMediaEntry(raw);
      if (!entry?.name) return;
      map.set(entry.name, featureStatusFromMap(r2FeatureMap, entry, FEATURE_MODELS));
    });
    return map;
  }, [currentProject?.preloadedImages, r2FeatureMap]);
  const mediaGroups = useMemo(
    () => analyzeTaggedSets(
      currentProject?.preloadedImages || [],
      currentProject?.imageDatasetConfig?.mediaFolderTags || {},
      null,
      { projectPrefix },
    ),
    [currentProject?.preloadedImages, currentProject?.imageDatasetConfig?.mediaFolderTags, projectPrefix],
  );
  const pairedGroups = mediaGroups;
  const groupSummary = useMemo(() => {
    const bySize = {};
    pairedGroups.forEach((g) => {
      bySize[g.size] = (bySize[g.size] || 0) + 1;
    });
    return { total: pairedGroups.length, bySize };
  }, [pairedGroups]);
  const filteredPairedGroups = useMemo(() => {
    if (groupSizeFilter === 'all') return pairedGroups;
    const n = parseInt(groupSizeFilter, 10);
    return pairedGroups.filter((g) => g.size === n);
  }, [pairedGroups, groupSizeFilter]);
  const mediaCategories = useMemo(
    () => analyzeTaggedCategories(
      currentProject?.preloadedImages || [],
      currentProject?.imageDatasetConfig?.mediaFolderTags || {},
      { projectPrefix },
    ),
    [currentProject?.preloadedImages, currentProject?.imageDatasetConfig?.mediaFolderTags, projectPrefix],
  );
  const mediaCounts = (currentProject?.preloadedImages || []).reduce((acc, m) => {
    const t = m.type || inferMediaType(m.name || m.url);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return (
    <Box>
      <AdminPageHeader
        icon={<CloudUpload />}
        title={t.mediaTitle}
        description={t.mediaDescription}
      />

      {!isR2Configured() && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          Cloudflare R2 is not configured. Set <code>REACT_APP_R2_PUBLIC_URL</code> (client) and the
          server-side <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>,{' '}
          <code>R2_SECRET_ACCESS_KEY</code>, <code>R2_BUCKET_NAME</code>, <code>R2_PUBLIC_URL</code>{' '}
          environment variables to enable image uploads.
        </Alert>
      )}

      {/* ── Current Status ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2, flexWrap: 'wrap' }}>
        {r2Syncing ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">{t.mediaCheckingR2}</Typography>
          </Box>
        ) : preloadedCount > 0 ? (
          <>
            <Chip icon={<CheckCircle />} label={`${preloadedCount} ${t.mediaInR2}`} color="success" variant="outlined" />
            {Object.entries(mediaCounts).map(([mediaType, n]) => (
              <Chip key={mediaType} size="small" label={`${n} ${mediaType}`} variant="outlined" />
            ))}
            <Chip label="Cloudflare R2" color="primary" size="small" variant="outlined" />
            {currentProject?.preloadedAt && (
              <Typography variant="caption" color="text.secondary">
                {t.mediaLastUpload} {new Date(currentProject.preloadedAt).toLocaleString()}
              </Typography>
            )}
          </>
        ) : (
          <Chip icon={<Warning />} label={t.noMediaYet} color="default" variant="outlined" />
        )}
      </Box>

      <Box
        sx={{
          mb: 2.5,
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          alignItems: 'stretch',
        }}
      >
        <MediaPairingGuide
          compact
          context="dataset"
          totalFileCount={preloadedCount}
          pairedSetCount={mediaGroups.length}
        />
        <MediaCategoryGuide
          compact
          context="dataset"
          categoryCount={mediaCategories.length}
          totalFileCount={preloadedCount}
          categoryLabels={mediaCategories.map((c) => c.category)}
        />
      </Box>

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        {t.mediaAddSection}
      </Typography>

      {/* ── Import / Upload / HF — three columns ── */}
      <Box
        sx={{
          mb: 3,
          display: 'grid',
          gap: 2,
          alignItems: 'stretch',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        {/* Import Template Images */}
        <Box sx={{
          p: 2.5,
          borderRadius: 1.5,
          border: '2px solid',
          borderColor: 'secondary.light',
          bgcolor: (t) => t.palette.mode === 'dark' ? 'background.paper' : 'action.hover',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ContentCopy fontSize="small" color="secondary" />
            {t.mediaImportTemplateTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.mediaImportTemplateHelp}
          </Typography>

          {(() => {
            const historyIds = Object.keys(templateImportHistory).filter((tid) => {
              const hist = templateImportHistory[tid];
              return Boolean(hist?.lastImportAt);
            });
            if (historyIds.length === 0) return null;
            return (
              <Box sx={{ mb: 1.5, maxHeight: 140, overflow: 'auto' }}>
                {historyIds.map((tid) => {
                  const hist = templateImportHistory[tid];
                  const tpl = isPreviewMediaImportId(tid)
                    ? { name: 'Preview media library' }
                    : availableTemplates.find((t) => t.id === tid);
                  const live = templateProgressMap[tid];
                  const total = live?.totalInTemplate
                    ?? hist?.totalInTemplate
                    ?? (isPreviewMediaImportId(tid) ? previewMediaCount : tpl?.preloadedImages?.length)
                    ?? 0;
                  const imported = live?.importedCount ?? hist?.importedCount ?? 0;
                  const remaining = live?.remaining ?? hist?.remaining ?? Math.max(0, total - imported);
                  const isComplete = live?.isComplete ?? hist?.isComplete ?? (total > 0 && remaining === 0);
                  const name = hist?.templateName || tpl?.name || tid;
                  const isActive = templateImportStatus.loading && templateImportStatus.activeTemplateId === tid;
                  return (
                    <Box key={tid} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                      <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap title={name}>
                        <strong>{name}</strong> · {imported}/{total}
                      </Typography>
                      {isComplete ? (
                        <Chip size="small" color="success" label="Done" sx={{ height: 20 }} />
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={templateImportStatus.loading}
                          onClick={() => {
                            setSelectedTemplateId(tid);
                            handleImportFromTemplate(tid);
                          }}
                          sx={{ py: 0, minHeight: 24 }}
                        >
                          {isActive ? '…' : `Resume ${remaining}`}
                        </Button>
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          })()}

          {!isR2Configured() ? (
            <Alert severity="warning" sx={{ mb: 1.5 }}>R2 not configured.</Alert>
          ) : loadingTemplates ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Loading…</Typography>
            </Box>
          ) : !hasImportSources ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              No templates or preview media library files yet.
            </Alert>
          ) : (
            <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
              <InputLabel id="template-import-select">Source</InputLabel>
              <Select
                labelId="template-import-select"
                label="Source"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                disabled={templateImportStatus.loading}
              >
                <MenuItem value={PREVIEW_MEDIA_IMPORT_ID}>
                  {(() => {
                    const live = templateProgressMap[PREVIEW_MEDIA_IMPORT_ID];
                    const hist = templateImportHistory[PREVIEW_MEDIA_IMPORT_ID];
                    const status = formatTemplateImportStatus(live, hist)
                      || (previewMediaCount > 0 ? `${previewMediaCount} files` : 'empty');
                    return `Preview media library (${status})`;
                  })()}
                </MenuItem>
                {availableTemplates.map((t) => {
                  const live = templateProgressMap[t.id];
                  const hist = templateImportHistory[t.id];
                  const status = formatTemplateImportStatus(live, hist)
                    || `${t.preloadedImages?.length || 0} files`;
                  return (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name} ({status})
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          )}

          {templateImportStatus.loading && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                {templateImportProgressLabel(templateImportStatus)}
              </Typography>
              <LinearProgress
                variant={templateImportStatus.phase === 'copying' && templateImportStatus.total > 0
                  ? 'determinate'
                  : 'indeterminate'}
                value={templateImportStatus.total > 0
                  ? Math.min((templateImportStatus.progress / templateImportStatus.total) * 100, 100)
                  : undefined}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
          {templateImportStatus.success && <Alert severity="success" sx={{ mb: 1.5 }}>{templateImportStatus.success}</Alert>}
          {templateImportStatus.error && <Alert severity="error" sx={{ mb: 1.5 }}>{templateImportStatus.error}</Alert>}

          <Box sx={{ mt: 'auto' }}>
            <Button
              fullWidth
              variant="contained"
              color="secondary"
              onClick={() => handleImportFromTemplate()}
              disabled={
                !isR2Configured()
                || templateImportStatus.loading
                || !selectedTemplateId
                || !hasImportSources
              }
              startIcon={templateImportStatus.loading ? <CircularProgress size={16} color="inherit" /> : <ContentCopy />}
            >
              {formatTemplateImportButtonLabel(selectedProgress, selectedImportHistory, {
                loading: templateImportStatus.loading,
                sourceKind: selectedIsPreviewMedia ? 'preview' : 'template',
              })}
            </Button>
          </Box>
        </Box>

        {/* Upload Media */}
        <Box sx={{
          p: 2.5,
          borderRadius: 1.5,
          border: '2px solid',
          borderColor: 'primary.light',
          bgcolor: (t) => t.palette.mode === 'dark' ? 'background.paper' : 'action.hover',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudUpload fontSize="small" color="primary" />
            {t.mediaUploadTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.mediaUploadHelpPrefix}
            {' '}({currentFolder ? <code>{currentFolder}</code> : 'root'}).
          </Typography>

          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => setSelectedFiles(Array.from(e.target.files))}
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={directUploadStatus.loading}>
              {t.mediaChooseFiles}
            </Button>
            {selectedFiles.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {selectedFiles.length} {t.mediaSelected}
              </Typography>
            )}
          </Box>

          {directUploadStatus.loading && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                Uploading… {directUploadStatus.progress} / {directUploadStatus.total}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={directUploadStatus.total > 0 ? (directUploadStatus.progress / directUploadStatus.total) * 100 : 0}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
          {directUploadStatus.success && <Alert severity="success" sx={{ mb: 1.5 }}>{directUploadStatus.success}</Alert>}
          {directUploadStatus.error && <Alert severity="error" sx={{ mb: 1.5 }}>{directUploadStatus.error}</Alert>}

          <Box sx={{ mt: 'auto' }}>
            <Button
              fullWidth
              variant="contained"
              color="primary"
              onClick={handleDirectUpload}
              disabled={!selectedFiles.length || directUploadStatus.loading || !isR2Configured()}
              startIcon={directUploadStatus.loading ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
            >
              {t.mediaUploadBtn}{selectedFiles.length > 0 ? ` ${selectedFiles.length}` : ''}
              {currentFolder ? ` → ${currentFolder}` : ` ${t.mediaUploadRoot}`}
            </Button>
          </Box>
        </Box>

        {/* HuggingFace Dataset Import */}
        <Box sx={{
          p: 2.5,
          borderRadius: 1.5,
          border: '2px solid',
          borderColor: 'warning.light',
          bgcolor: (t) => t.palette.mode === 'dark' ? 'background.paper' : 'action.hover',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          <Typography variant="subtitle1" sx={{ mb: 0.75, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            {t.hfImportTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.hfImportHelp}
          </Typography>

          <FormControlLabel
            sx={{ mb: 1, ml: 0 }}
            control={<Switch size="small" checked={hfConfig.enabled} onChange={(e) => setHfConfig(p => ({ ...p, enabled: e.target.checked }))} />}
            label={<Typography variant="body2">{t.hfEnable}</Typography>}
          />
          <TextField
            fullWidth size="small" label={t.hfToken} type="password"
            value={hfConfig.token}
            onChange={(e) => setHfConfig(p => ({ ...p, token: e.target.value }))}
            disabled={!hfConfig.enabled}
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth size="small" label={t.hfDataset}
            value={hfConfig.datasetName}
            onChange={(e) => setHfConfig(p => ({ ...p, datasetName: e.target.value }))}
            placeholder={t.hfPlaceholder}
            disabled={!hfConfig.enabled}
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={saveHfConfig} disabled={!hfConfig.enabled || !hfConfig.datasetName}>
              {t.saveConfig}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={testHfConnection}
              disabled={!hfConfig.enabled || !hfConfig.datasetName || hfStatus.loading}
              startIcon={hfStatus.loading ? <CircularProgress size={14} /> : <Refresh />}
            >
              {t.testConnection}
            </Button>
          </Box>

          {(hfStatus.connected || hfStatus.error) && (
            <Alert severity={hfStatus.connected ? 'success' : 'error'} sx={{ mb: 1.5 }} icon={false}>
              <Typography variant="caption">
                {hfStatus.connected
                  ? `Connected${hfStatus.datasetInfo?.imageCount != null ? ` · ${hfStatus.datasetInfo.imageCount} images` : ''}`
                  : hfStatus.error}
              </Typography>
            </Alert>
          )}
          {preloadStatus.loading && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                HF → R2… {preloadStatus.progress} / {preloadStatus.total}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={preloadStatus.total > 0 ? (preloadStatus.progress / preloadStatus.total) * 100 : 0}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
          {preloadStatus.success && <Alert severity="success" sx={{ mb: 1.5 }}>{preloadStatus.success}</Alert>}
          {preloadStatus.error && <Alert severity="error" sx={{ mb: 1.5 }}>{preloadStatus.error}</Alert>}

          <Box sx={{ mt: 'auto' }}>
            <Button
              fullWidth
              variant="contained"
              onClick={handlePreloadAllImages}
              disabled={!hfStatus.connected || !isR2Configured() || preloadStatus.loading}
              startIcon={preloadStatus.loading ? <CircularProgress size={16} /> : <CloudDownload />}
            >
              {preloadedCount > 0 ? t.hfRePreload : t.hfPreload}
            </Button>
          </Box>
        </Box>
      </Box>

      <SpatialIntelligencePanel
        currentProject={currentProject}
        onProjectUpdate={onProjectUpdate}
        onConfigChange={onConfigChange}
        onFeaturesUpdated={setR2FeatureMap}
      />

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: 1 }}>
        {t.mediaOrganizeSection}
      </Typography>

      <MediaFolderBrowser
        currentProject={currentProject}
        userId={userId}
        onProjectUpdate={onProjectUpdate}
        currentFolder={currentFolder}
        onCurrentFolderChange={setCurrentFolder}
        selectedMediaEntries={(currentProject?.preloadedImages || []).filter((m) => selectedMedia.has(m.name))}
        openMoveSignal={openMoveSignal}
        mediaCount={preloadedCount}
      >
        {preloadedCount === 0 ? (
          <Alert severity="info">
            No media uploaded yet. Use the import / upload cards above, then organize files with folders on the left.
          </Alert>
        ) : (
          <>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
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
                  startIcon={<DriveFileMove />}
                  onClick={() => setOpenMoveSignal((n) => n + 1)}
                  disabled={!selectedMedia.size || mediaActionStatus.loading}
                >
                  Move to folder… ({selectedMedia.size})
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
                  Click a card to focus Pre-annotate below (images); use checkboxes for multi-select download / move / delete.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
                  {pagedMedia.map((img) => {
                    const t = img.type || inferMediaType(img.name || img.url);
                    const selected = selectedMedia.has(img.name);
                    const focused = preannotateFocusName === img.name;
                    const feat = featureStatusByName.get(img.name);
                    const l0Status = feat?.status?.[L0_MODEL];
                    const segStatus = feat?.status?.[SEG_MODEL];
                    const samStatus = feat?.status?.[SAM_PREANNOT_MODEL];
                    const l0Ok = l0Status === 'ready';
                    const segOk = segStatus === 'ready';
                    const samOk = samStatus === 'ready';
                    const l0Err = l0Status === 'error';
                    const segErr = segStatus === 'error';
                    return (
                      <Box
                        key={img.key || img.media_id || img.name}
                        sx={{
                          position: 'relative',
                          borderRadius: 1,
                          overflow: 'hidden',
                          border: '2px solid',
                          borderColor: focused ? 'secondary.main' : selected ? 'primary.main' : 'divider',
                          boxShadow: focused ? 2 : 0,
                          bgcolor: 'grey.100',
                          cursor: 'pointer',
                          transition: 'border-color .15s, box-shadow .15s',
                          '&:hover .media-action-btn': { opacity: 1 },
                        }}
                        onClick={() => handleMediaCardClick(img)}
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
                          {(img.folder || '') !== '' && (
                            <Typography variant="caption" color="text.secondary" noWrap title={img.folder} sx={{ display: 'block' }}>
                              📁 {img.folder}
                            </Typography>
                          )}
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                            <Chip size="small" label={t} variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                            {t === 'image' && l0Ok && (
                              <Chip
                                size="small"
                                label="L0"
                                color="success"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFeatureInspect({
                                    name: img.name,
                                    mediaId: feat.mediaId,
                                    records: feat.records,
                                    url: img.url,
                                  });
                                }}
                              />
                            )}
                            {t === 'image' && l0Err && (
                              <Chip size="small" label="L0!" color="warning" sx={{ height: 18, fontSize: '0.65rem' }} title="L0 failed" />
                            )}
                            {t === 'image' && segOk && (
                              <Chip
                                size="small"
                                label="Seg"
                                color="info"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFeatureInspect({
                                    name: img.name,
                                    mediaId: feat.mediaId,
                                    records: feat.records,
                                    url: img.url,
                                  });
                                }}
                              />
                            )}
                            {t === 'image' && segErr && (
                              <Chip size="small" label="Seg!" color="warning" sx={{ height: 18, fontSize: '0.65rem' }} title="Seg failed" />
                            )}
                            {t === 'image' && samOk && (
                              <Chip
                                size="small"
                                label="SAM"
                                color="secondary"
                                sx={{ height: 18, fontSize: '0.65rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFeatureInspect({
                                    name: img.name,
                                    mediaId: feat.mediaId,
                                    records: feat.records,
                                    url: img.url,
                                  });
                                }}
                              />
                            )}
                          </Box>
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
          </>
        )}
      </MediaFolderBrowser>

      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, mt: 0.5, letterSpacing: 1 }}>
        {t.mediaTaggedSection}
      </Typography>

      {pairedGroups.length === 0 && mediaCategories.length === 0 && (
        <Alert severity="info" sx={{ mb: 2.5 }}>
          {t.mediaNoFoldersTagged}
        </Alert>
      )}

      {pairedGroups.length > 0 && (
        <Box sx={{ mb: 2.5, p: 2.5, bgcolor: 'background.paper', border: '2px solid', borderColor: 'info.light', borderRadius: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {tf(t.mediaTaggedSets, { n: pairedGroups.length })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.mediaTaggedSetsHelp}
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
                  <TableCell>Set folder</TableCell>
                  <TableCell align="center">Size</TableCell>
                  <TableCell>Types</TableCell>
                  <TableCell>Files</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPairedGroups.slice(0, 50).map((g) => (
                  <TableRow key={g.setKey || g.folder} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{g.folder || g.setId || g.groupId}</Typography>
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

      {mediaCategories.length > 0 && (
        <Box sx={{ mb: 2.5, p: 2.5, bgcolor: 'background.paper', border: '2px solid', borderColor: 'secondary.light', borderRadius: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {tf(t.mediaTaggedCategories, { n: mediaCategories.length })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t.mediaTaggedCategoriesHelp}
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

      {/* ── SAM3 Pre-annotate (synced with gallery selection) ── */}
      {preloadedCount > 0 && (
        <MediaPreannotatePanel
          mediaEntry={preannotateEntry}
          imageIndex={preannotateIndex}
          imageTotal={preannotateImages.length}
          onPrev={() => {
            if (preannotateIndex <= 0) return;
            const prev = preannotateImages[preannotateIndex - 1];
            if (prev) focusMediaInGallery(prev.name);
          }}
          onNext={() => {
            if (preannotateIndex >= preannotateImages.length - 1) return;
            const next = preannotateImages[preannotateIndex + 1];
            if (next) focusMediaInGallery(next.name);
          }}
          r2Prefix={projectPrefix}
          falKey={currentProject?.imageDatasetConfig?.falApiKey || ''}
          projectId={projectId || ''}
          onSaved={(result) => {
            const annotation = result?.annotation || null;
            const mediaEntry = preannotateEntry
              || (annotation
                ? { name: annotation.name, url: annotation.image, media_id: annotation.media_id }
                : null);
            setPreannotateSavedPatch({
              mediaEntry,
              annotation,
              at: Date.now(),
            });
            // Patch feature map locally — avoid re-downloading all feature CSVs on every autosave.
            const rec = result?.featureRecord;
            if (rec) {
              setR2FeatureMap((prev) => {
                const next = { ...prev };
                if (rec.media_id) next[featureStorageKey(rec.media_id, SAM_PREANNOT_MODEL)] = rec;
                if (rec.name) next[featureStorageKey(rec.name, SAM_PREANNOT_MODEL)] = rec;
                return next;
              });
            }
          }}
        />
      )}

      {preloadedCount > 0 && (
        <MediaPreannotateResults
          r2Prefix={projectPrefix}
          mediaList={preannotateImages}
          featureMap={r2FeatureMap}
          savedPatch={preannotateSavedPatch}
        />
      )}

      {onNextStep && (
        <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" color="primary" size="large" onClick={onNextStep} sx={{ px: 4, py: 1.5, fontWeight: 600 }}>
            Next: Survey Builder →
          </Button>
        </Box>
      )}

      <Dialog open={!!featureInspect} onClose={() => setFeatureInspect(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{featureInspect?.name || 'Image features'}</DialogTitle>
        <DialogContent dividers>
          {featureInspect?.url && (
            <Box sx={{ mb: 2, textAlign: 'center' }}>
              <img
                src={featureInspect.url}
                alt={featureInspect.name}
                style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }}
              />
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            media_id: {featureInspect?.mediaId}
          </Typography>
          {featureInspect?.records?.[L0_MODEL]?.features && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>L0 ({L0_MODEL})</Typography>
              {Object.entries(featureInspect.records[L0_MODEL].features).map(([k, v]) => (
                <Typography key={k} variant="caption" sx={{ display: 'block', fontFamily: 'monospace' }}>
                  {k}: {typeof v === 'number' ? v.toFixed(4) : String(v)}
                </Typography>
              ))}
            </Box>
          )}
          {featureInspect?.records?.[SEG_MODEL]?.features && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Streetscape seg ({SEG_MODEL})</Typography>
              {Object.entries(featureInspect.records[SEG_MODEL].features)
                .filter(([k]) => k.startsWith('seg_ratio_'))
                .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                .map(([k, v]) => (
                  <Box key={k} sx={{ mb: 0.75 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption">{k.replace('seg_ratio_', '')}</Typography>
                      <Typography variant="caption">{typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—'}</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={typeof v === 'number' ? Math.min(100, v * 100) : 0}
                      sx={{ height: 6, borderRadius: 1 }}
                    />
                  </Box>
                ))}
            </Box>
          )}
          {featureInspect?.records?.[SAM_PREANNOT_MODEL]?.features && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>SAM pre-annot ({SAM_PREANNOT_MODEL})</Typography>
              {Object.entries(featureInspect.records[SAM_PREANNOT_MODEL].features).map(([k, v]) => (
                <Typography key={k} variant="caption" sx={{ display: 'block', fontFamily: 'monospace' }}>
                  {k}: {typeof v === 'number' ? v.toFixed(4) : String(v)}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFeatureInspect(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </Box>
  );
}
