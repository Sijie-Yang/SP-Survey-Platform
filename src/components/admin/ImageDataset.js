import React, { useState, useEffect, useRef } from 'react';
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
} from '@mui/icons-material';
import {
  testHuggingFaceConnection,
  getImagesFromHuggingFace,
  getImageCountFromDataset,
} from '../../lib/huggingface';
import { isR2Configured, uploadImageToR2, deleteImagesFromR2, listImagesFromR2 } from '../../lib/r2';
import { useRegion } from '../../contexts/RegionContext';
import { useAuth } from '../../contexts/AuthContext';

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
        const images = result.images.map((img) => ({ url: img.url, name: img.name }));
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
        const file = await compressImage(raw); // compress to ≤300KB client-side
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const userId = user?.id || 'anonymous';
        const key = `${userId}/${currentProject?.id || 'default'}/${safeName}`;

        const result = await uploadImageToR2(file, key);

        if (result.success) {
          uploadedImages.push({ url: result.url, name: raw.name });
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
        success: `Successfully uploaded ${successCount} image(s) to Cloudflare R2!`,
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
        allImages.push({ url: img.url, name: img.name });
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
            allImages.push({ url: uploadResult.url, name: fname });
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
    if (onConfigChange) onConfigChange(true, updatedProject.imageDatasetConfig);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const preloadedCount = currentProject?.preloadedImages?.length || 0;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 1, color: 'primary.main' }}>
        🖼️ Image Dataset
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upload images to Cloudflare R2. They will be served to survey participants.
        HuggingFace batch import is available as an optional tool.
      </Typography>

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
            <Chip icon={<CheckCircle />} label={`${preloadedCount} images in R2`} color="success" variant="outlined" />
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

      {/* ── Direct Upload ── */}
      <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'primary.light' }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CloudUpload fontSize="small" color="primary" />
          Upload Images to Cloudflare R2
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select image files to upload to Cloudflare R2.
          Images over 300 KB are automatically compressed in your browser before upload.
        </Typography>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => setSelectedFiles(Array.from(e.target.files))}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => fileInputRef.current?.click()} disabled={directUploadStatus.loading}>
            Choose Image Files
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
          Upload {selectedFiles.length > 0 ? `${selectedFiles.length} Image(s)` : ''} to R2
        </Button>
      </Box>

      {/* ── Image Preview ── */}
      {preloadedCount > 0 && (
        <Box sx={{ mb: 3, p: 3, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            🖼️ Uploaded Images (preview — first 10):
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {currentProject.preloadedImages.slice(0, 10).map((img, i) => (
              <Box key={i} sx={{ width: 100, height: 100, borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                <img
                  src={img.url} alt={img.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:#999;">Failed</div>';
                  }}
                />
              </Box>
            ))}
          </Box>
          {preloadedCount > 10 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              ... and {preloadedCount - 10} more images
            </Typography>
          )}
          <Button variant="outlined" color="error" onClick={handleClearImages} startIcon={<Delete />} size="small">
            Clear All Images
          </Button>
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
              3. Format: <code>owner/dataset</code> for parquet-style datasets,
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
