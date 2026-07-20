import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Container, Stack, TextField, Typography,
} from '@mui/material';
import {
  AttachFile, CheckCircle, ContentCopy, CloudUpload, Description,
} from '@mui/icons-material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';
import { isR2Configured } from '../lib/r2';
import {
  MAX_DATASET_IMAGES,
  MAX_SUPPLEMENTARY_BYTES,
  MAX_SUPPLEMENTARY_FILES,
  SUPPLEMENTARY_ACCEPT,
  submitPaperTemplateRequest,
} from '../lib/templateRequest';

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RequestTemplatePage() {
  const { t } = useRegion();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [year, setYear] = useState('');
  const [paperUrl, setPaperUrl] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [supplementary, setSupplementary] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const next = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
    setPreviews(next);
    return () => next.forEach((p) => URL.revokeObjectURL(p.url));
  }, [files]);

  const onPickImages = (e) => {
    const picked = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_DATASET_IMAGES));
    e.target.value = '';
  };

  const onPickSupplementary = (e) => {
    const picked = Array.from(e.target.files || []);
    setSupplementary((prev) => [...prev, ...picked].slice(0, MAX_SUPPLEMENTARY_FILES));
    e.target.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setCopied(false);
    if (!name.trim() || !author.trim() || !paperUrl.trim()) {
      setError(t.reqTplNeedFields);
      return;
    }
    if (year.trim() && !/^\d{4}$/.test(year.trim())) {
      setError(t.reqTplBadYear);
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t.reqTplBadEmail);
      return;
    }
    const oversized = supplementary.find((f) => f.size > MAX_SUPPLEMENTARY_BYTES);
    if (oversized) {
      setError(tf(t.reqFileTooLarge, { name: oversized.name, mb: Math.round(MAX_SUPPLEMENTARY_BYTES / (1024 * 1024)) }));
      return;
    }
    if ((files.length || supplementary.length) && !isR2Configured()) {
      setError(t.reqUploadUnavailable);
      return;
    }
    setSubmitting(true);
    setProgress(t.reqStarting);
    try {
      const res = await submitPaperTemplateRequest({
        name: name.trim(),
        author: author.trim(),
        year: year.trim(),
        paperUrl: paperUrl.trim(),
        notes: notes.trim(),
        email: email.trim(),
        files,
        supplementaryFiles: supplementary,
        onProgress: (p) => {
          if (p.phase === 'upload' && p.total) {
            setProgress(tf(t.reqUploading, { current: p.current || 0, total: p.total }));
          } else {
            setProgress(p.message || '');
          }
        },
      });
      setResult(res);
      setFiles([]);
      setSupplementary([]);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSubmitting(false);
      setProgress('');
    }
  };

  const copyId = async () => {
    if (!result?.templateId) return;
    try {
      await navigator.clipboard.writeText(result.templateId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const resetForm = () => {
    setResult(null);
    setName('');
    setAuthor('');
    setPaperUrl('');
    setNotes('');
    setEmail('');
    setYear('');
    setFiles([]);
    setSupplementary([]);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      <Container maxWidth="sm" sx={{ py: 5, flex: 1 }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h4" fontWeight={800}>
            {t.reqTplTitle}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t.reqTplIntro}{' '}
            <Box
              component={RouterLink}
              to="/request-survey-design"
              sx={{ color: 'primary.main', fontWeight: 600, textDecoration: 'none' }}
            >
              {t.reqTplLinkDesign}
            </Box>
            .
          </Typography>
        </Stack>

        {result ? (
          <Stack spacing={2}>
            <Alert severity="success" icon={<CheckCircle />}>
              {t.reqTplSuccess}
            </Alert>
            <Box
              sx={{
                p: 2.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {t.reqTplId}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {result.templateId}
                </Typography>
                <Button size="small" startIcon={<ContentCopy />} onClick={copyId}>
                  {copied ? t.reqCopied : t.reqCopy}
                </Button>
              </Stack>
              {(result.imageCount > 0 || result.supplementaryCount > 0) && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {[
                    result.imageCount > 0
                      ? tf(t.reqTplImagesCount, { n: result.imageCount })
                      : null,
                    result.supplementaryCount > 0
                      ? tf(t.reqTplSuppCount, { n: result.supplementaryCount })
                      : null,
                  ].filter(Boolean).join(' · ') + t.reqUploaded}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                {t.reqTplStatus}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="contained" onClick={() => navigate('/login')}>
                {t.navResearcherLogin}
              </Button>
              <Button variant="outlined" onClick={resetForm}>
                {t.reqSubmitAnother}
              </Button>
              <Button variant="text" onClick={() => navigate('/')}>
                {t.reqBackHome}
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              {error && <Alert severity="error">{error}</Alert>}

              <TextField
                label={t.reqTplPaperTitle}
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
              />
              <TextField
                label={t.reqTplAuthors}
                required
                fullWidth
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                helperText={t.reqTplAuthorsHelp}
                disabled={submitting}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={t.reqTplYear}
                  fullWidth
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder={t.reqTplYearPh}
                  disabled={submitting}
                  inputProps={{ inputMode: 'numeric', maxLength: 4 }}
                />
                <TextField
                  label={t.reqTplLink}
                  required
                  fullWidth
                  value={paperUrl}
                  onChange={(e) => setPaperUrl(e.target.value)}
                  placeholder={t.reqTplLinkPh}
                  disabled={submitting}
                />
              </Stack>
              <TextField
                label={t.reqTplEmail}
                type="email"
                fullWidth
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                helperText={t.reqTplEmailHelp}
                disabled={submitting}
                autoComplete="email"
              />
              <TextField
                label={t.reqTplNotes}
                fullWidth
                multiline
                minRows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                helperText={t.reqTplNotesHelp}
                disabled={submitting}
              />

              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider',
                  bgcolor: 'grey.50',
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <CloudUpload fontSize="small" color="action" />
                  <Typography variant="subtitle2" fontWeight={700}>
                    {t.reqTplImages}
                  </Typography>
                  <Chip size="small" label={tf(t.reqMax, { n: MAX_DATASET_IMAGES })} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {t.reqTplImagesHelp}
                </Typography>
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                  startIcon={<Description />}
                  disabled={submitting || files.length >= MAX_DATASET_IMAGES}
                >
                  {t.reqTplChooseImages}
                  <input hidden type="file" accept="image/*" multiple onChange={onPickImages} />
                </Button>
                {files.length > 0 && (
                  <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    {tf(t.reqFilesSelected, { n: files.length })}
                    {' · '}
                    <Box
                      component="button"
                      type="button"
                      onClick={() => setFiles([])}
                      sx={{
                        border: 0, background: 'none', p: 0, color: 'primary.main',
                        cursor: 'pointer', font: 'inherit',
                      }}
                    >
                      {t.reqClear}
                    </Box>
                  </Typography>
                )}
                {previews.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                    {previews.slice(0, 24).map((p) => (
                      <Box
                        key={p.url}
                        component="img"
                        src={p.url}
                        alt={p.name}
                        title={p.name}
                        sx={{
                          width: 64, height: 64, objectFit: 'cover',
                          borderRadius: 1, border: '1px solid', borderColor: 'divider',
                        }}
                      />
                    ))}
                    {previews.length > 24 && (
                      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                        {tf(t.reqMore, { n: previews.length - 24 })}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>

              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider',
                  bgcolor: 'grey.50',
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <AttachFile fontSize="small" color="action" />
                  <Typography variant="subtitle2" fontWeight={700}>
                    {t.reqTplSupp}
                  </Typography>
                  <Chip size="small" label={tf(t.reqMax, { n: MAX_SUPPLEMENTARY_FILES })} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {tf(t.reqTplSuppHelp, { mb: Math.round(MAX_SUPPLEMENTARY_BYTES / (1024 * 1024)) })}
                </Typography>
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                  startIcon={<AttachFile />}
                  disabled={submitting || supplementary.length >= MAX_SUPPLEMENTARY_FILES}
                >
                  {t.reqChooseFiles}
                  <input
                    hidden
                    type="file"
                    accept={SUPPLEMENTARY_ACCEPT}
                    multiple
                    onChange={onPickSupplementary}
                  />
                </Button>
                {supplementary.length > 0 && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                      {tf(t.reqFilesSelected, { n: supplementary.length })}
                      {' · '}
                      <Box
                        component="button"
                        type="button"
                        onClick={() => setSupplementary([])}
                        sx={{
                          border: 0, background: 'none', p: 0, color: 'primary.main',
                          cursor: 'pointer', font: 'inherit',
                        }}
                      >
                        {t.reqClear}
                      </Box>
                    </Typography>
                    <Stack spacing={0.5}>
                      {supplementary.map((f) => (
                        <Typography key={`${f.name}-${f.size}`} variant="caption" color="text.secondary">
                          {f.name} ({formatBytes(f.size)})
                        </Typography>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Box>

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={submitting}
                sx={{ fontWeight: 700, py: 1.25 }}
              >
                {submitting ? (progress || t.reqSubmitting) : t.reqSubmit}
              </Button>
            </Stack>
          </Box>
        )}
      </Container>

      <PublicFooter />
    </Box>
  );
}
