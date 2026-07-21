/**
 * Platform admin tab: manage the shared preview media library with the same
 * Media Library UI used for templates/projects (folders, set/category tags, upload).
 */
import React, { useCallback, useState } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import AdminScopedMediaLibrary from './AdminScopedMediaLibrary';
import { PREVIEW_MEDIA_PREFIX } from '../../lib/previewMediaLibrary';
import { formatMediaMb, MAX_AV_MEDIA_BYTES, sanitizeMediaFolderConfig } from '../../lib/mediaUtils';

const CONFIG_STORAGE_KEY = 'sp-preview-media-library-config';

function loadStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeMediaFolderConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}

export default function PreviewMediaLibraryManagement() {
  const [owner, setOwner] = useState(() => ({
    id: 'preview-media',
    preloadedImages: [],
    imageDatasetConfig: loadStoredConfig(),
    preloadedSource: 'r2',
    preloadedAt: null,
  }));

  const handlePersist = useCallback(async (payload) => {
    setOwner((prev) => {
      const nextConfig = payload.image_dataset_config != null
        ? sanitizeMediaFolderConfig(payload.image_dataset_config)
        : (prev.imageDatasetConfig || {});
      try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(nextConfig));
      } catch { /* ignore quota */ }
      return {
        ...prev,
        preloadedImages: payload.preloaded_images || [],
        preloadedAt: payload.preloaded_at || new Date().toISOString(),
        preloadedSource: payload.preloaded_source || 'r2',
        imageDatasetConfig: nextConfig,
      };
    });
  }, []);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 0.5 }}>预览媒体库</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        全局共享媒体（R2: <code>{PREVIEW_MEDIA_PREFIX}</code>）。项目 / 模板没有媒体时，问卷预览、题目编辑预览、Skill
        案例预览都会从这里抽样。图片约压缩至 300 KB；视频/音频上限 {formatMediaMb(MAX_AV_MEDIA_BYTES)} MB。
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        与模板/项目媒体库相同的文件夹与 Set / Category 标记工具。文件保存在 R2；文件夹标记保存在本机浏览器（不写入某个项目或模板行）。
      </Alert>
      <AdminScopedMediaLibrary
        r2Prefix={PREVIEW_MEDIA_PREFIX}
        owner={owner}
        onPersist={handlePersist}
        enableSupplementary={false}
        allowTemplateKeys={false}
        rootLabel="preview-media"
        userId="platform"
      />
    </Box>
  );
}
