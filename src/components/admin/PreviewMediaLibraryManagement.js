/**
 * Platform admin tab: manage the shared preview media library with the same
 * Media Library UI used for templates/projects (folders, set/category tags, upload).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import AdminScopedMediaLibrary from './AdminScopedMediaLibrary';
import { PREVIEW_MEDIA_PREFIX } from '../../lib/previewMediaLibrary';
import { formatMediaMb, MAX_AV_MEDIA_BYTES } from '../../lib/mediaUtils';
import { loadPreviewMediaLibrary, savePreviewMediaLibrary, withLegacyPreviewConfig } from '../../lib/previewMediaLibraryStorage';

export default function PreviewMediaLibraryManagement() {
  const [owner, setOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ownerRef = useRef(null);
  const savingRef = useRef(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    setOwner(null);
    ownerRef.current = null;
    try {
      const next = withLegacyPreviewConfig(await loadPreviewMediaLibrary());
      if (sequence !== loadSequence.current) return;
      ownerRef.current = next;
      setOwner(next);
    } catch (err) {
      if (sequence === loadSequence.current) setError(err.message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  const handlePersist = useCallback(async (payload) => {
    if (!ownerRef.current) throw new Error('请先加载云端媒体库。');
    if (savingRef.current) throw new Error('上一项修改仍在保存，请稍后重试。');
    savingRef.current = true;
    setSaving(true);
    const sequence = loadSequence.current;
    try {
      const next = await savePreviewMediaLibrary(ownerRef.current, payload);
      if (sequence !== loadSequence.current) return;
      ownerRef.current = next;
      setOwner(next);
      setError('');
    } catch (err) {
      if (sequence === loadSequence.current) setError(err.message);
      throw err;
    } finally {
      savingRef.current = false;
      if (sequence === loadSequence.current) setSaving(false);
    }
  }, []);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 0.5 }}>预览媒体库</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        全局共享媒体（R2: <code>{PREVIEW_MEDIA_PREFIX}</code>）。项目 / 模板没有媒体时，问卷预览、题目编辑预览、Skill
        案例预览都会从这里抽样。图片约压缩至 300 KB；视频/音频上限 {formatMediaMb(MAX_AV_MEDIA_BYTES)} MB。
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        与模板/项目媒体库相同的文件夹与 Set / Category 标记工具。文件保存在 Cloudflare R2；文件夹、分类标签和图片的目录归属统一保存在 Supabase，重新打开或换设备后仍会保留。
      </Alert>
      {error && <Alert severity="error" sx={{ mb: 2 }} action={
        <Button color="inherit" size="small" disabled={loading || saving} onClick={load}>重新加载云端记录</Button>
      }>{error}</Alert>}
      {loading && <Box role="status" sx={{ py: 3 }}><CircularProgress size={20} sx={{ mr: 1 }} />正在加载云端媒体库…</Box>}
      {owner && <AdminScopedMediaLibrary
        r2Prefix={PREVIEW_MEDIA_PREFIX}
        owner={owner}
        onPersist={handlePersist}
        enableSupplementary={false}
        allowTemplateKeys={false}
        rootLabel="preview-media"
        userId="platform"
      />}
    </Box>
  );
}
