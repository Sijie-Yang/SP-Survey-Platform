import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, Container, FormControlLabel, FormGroup,
  Stack, TextField, Typography,
} from '@mui/material';
import {
  AttachFile, CheckCircle, ContentCopy, CloudUpload, DesignServices, Description,
} from '@mui/icons-material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { isR2Configured } from '../lib/r2';
import {
  MAX_MEDIA_FILES,
  MAX_SUPPLEMENTARY_BYTES,
  MAX_SUPPLEMENTARY_FILES,
  STIMULUS_OPTIONS,
  SUPPLEMENTARY_ACCEPT,
  submitSurveyDesignRequest,
} from '../lib/surveyDesignRequest';

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RequestSurveyDesignPage() {
  const navigate = useNavigate();
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [studyTitle, setStudyTitle] = useState('');
  const [researchBrief, setResearchBrief] = useState('');
  const [stimulusTypes, setStimulusTypes] = useState([]);
  const [timeline, setTimeline] = useState('');
  const [relatedUrl, setRelatedUrl] = useState('');
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
    const imageFiles = files.filter((f) => f.type?.startsWith('image/'));
    const next = imageFiles.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
    setPreviews(next);
    return () => next.forEach((p) => URL.revokeObjectURL(p.url));
  }, [files]);

  const toggleStimulus = (value) => {
    setStimulusTypes((prev) => (
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    ));
  };

  const onPickMedia = (e) => {
    const picked = Array.from(e.target.files || []).filter((f) => (
      f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/')
    ));
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_MEDIA_FILES));
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
    if (!contactName.trim() || !email.trim() || !studyTitle.trim() || !researchBrief.trim()) {
      setError('Please fill in name, email, study title, and research brief.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email so we can follow up.');
      return;
    }
    if (researchBrief.trim().length < 40) {
      setError('Please describe your study in a bit more detail (at least a few sentences).');
      return;
    }
    const oversized = supplementary.find((f) => f.size > MAX_SUPPLEMENTARY_BYTES);
    if (oversized) {
      setError(`"${oversized.name}" is too large (max ${Math.round(MAX_SUPPLEMENTARY_BYTES / (1024 * 1024))} MB).`);
      return;
    }
    if ((files.length || supplementary.length) && !isR2Configured()) {
      setError('File upload is not available right now. Submit without files, or try again later.');
      return;
    }
    setSubmitting(true);
    setProgress('Starting…');
    try {
      const res = await submitSurveyDesignRequest({
        contactName: contactName.trim(),
        email: email.trim(),
        affiliation: affiliation.trim(),
        studyTitle: studyTitle.trim(),
        researchBrief: researchBrief.trim(),
        stimulusTypes,
        timeline: timeline.trim(),
        relatedUrl: relatedUrl.trim(),
        notes: notes.trim(),
        files,
        supplementaryFiles: supplementary,
        onProgress: (p) => {
          if (p.phase === 'upload' && p.total) {
            setProgress(`Uploading (${p.current || 0}/${p.total})…`);
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
    if (!result?.requestId) return;
    try {
      await navigator.clipboard.writeText(result.requestId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const resetForm = () => {
    setResult(null);
    setContactName('');
    setEmail('');
    setAffiliation('');
    setStudyTitle('');
    setResearchBrief('');
    setStimulusTypes([]);
    setTimeline('');
    setRelatedUrl('');
    setNotes('');
    setFiles([]);
    setSupplementary([]);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      <Container maxWidth="sm" sx={{ py: 5, flex: 1 }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <DesignServices color="primary" />
            <Typography variant="h4" fontWeight={800}>
              Request Survey Design
            </Typography>
          </Stack>
          <Typography variant="body1" color="text.secondary">
            Planning a perception study and want help turning it into an SP-Survey?
            Share a short research brief — this is best-effort research collaboration,
            not a paid service. Prefer to convert a published paper into a reusable template?{' '}
            <Box
              component={RouterLink}
              to="/request-template"
              sx={{ color: 'primary.main', fontWeight: 600, textDecoration: 'none' }}
            >
              Request a template instead
            </Box>
            .
          </Typography>
        </Stack>

        {result ? (
          <Stack spacing={2}>
            <Alert severity="success" icon={<CheckCircle />}>
              Request submitted. Save your request ID — we will follow up by email when we can help.
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
                Request ID
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {result.requestId}
                </Typography>
                <Button size="small" startIcon={<ContentCopy />} onClick={copyId}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </Stack>
              {(result.mediaCount > 0 || result.supplementaryCount > 0) && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {[
                    result.mediaCount > 0
                      ? `${result.mediaCount} media file${result.mediaCount === 1 ? '' : 's'}`
                      : null,
                    result.supplementaryCount > 0
                      ? `${result.supplementaryCount} supplementary file${result.supplementaryCount === 1 ? '' : 's'}`
                      : null,
                  ].filter(Boolean).join(' · ') + ' uploaded.'}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Status: pending. We review requests as capacity allows and will email you
                if we can help design or scaffold your survey.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="contained" onClick={() => navigate('/login')}>
                Or start building yourself
              </Button>
              <Button variant="outlined" onClick={resetForm}>
                Submit another
              </Button>
              <Button variant="text" onClick={() => navigate('/')}>
                Back to home
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              {error && <Alert severity="error">{error}</Alert>}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Your name"
                  required
                  fullWidth
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  disabled={submitting}
                />
                <TextField
                  label="Email"
                  type="email"
                  required
                  fullWidth
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  helperText="Required so we can follow up."
                  disabled={submitting}
                  autoComplete="email"
                />
              </Stack>
              <TextField
                label="Affiliation (optional)"
                fullWidth
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                placeholder="e.g. Urban Analytics Lab, NUS"
                disabled={submitting}
              />
              <TextField
                label="Study title"
                required
                fullWidth
                value={studyTitle}
                onChange={(e) => setStudyTitle(e.target.value)}
                disabled={submitting}
              />
              <TextField
                label="Research brief"
                required
                fullWidth
                multiline
                minRows={4}
                value={researchBrief}
                onChange={(e) => setResearchBrief(e.target.value)}
                helperText="What do you want to measure, with whom, and roughly how? A few sentences is enough."
                disabled={submitting}
              />

              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Stimulus media (optional)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  What participants will see or hear.
                </Typography>
                <FormGroup row>
                  {STIMULUS_OPTIONS.map((opt) => (
                    <FormControlLabel
                      key={opt.value}
                      control={(
                        <Checkbox
                          size="small"
                          checked={stimulusTypes.includes(opt.value)}
                          onChange={() => toggleStimulus(opt.value)}
                          disabled={submitting}
                        />
                      )}
                      label={opt.label}
                    />
                  ))}
                </FormGroup>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Timeline (optional)"
                  fullWidth
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                  placeholder="e.g. pilot in August, full run in October"
                  disabled={submitting}
                />
                <TextField
                  label="Related link (optional)"
                  fullWidth
                  value={relatedUrl}
                  onChange={(e) => setRelatedUrl(e.target.value)}
                  placeholder="Paper, project page, or dataset URL"
                  disabled={submitting}
                />
              </Stack>
              <TextField
                label="Additional notes (optional)"
                fullWidth
                multiline
                minRows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                helperText="Question types you have in mind, sample size targets, constraints, etc."
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
                    Sample media (optional)
                  </Typography>
                  <Chip size="small" label={`max ${MAX_MEDIA_FILES}`} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Images, video, or audio examples. Images are auto-compressed before upload.
                </Typography>
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                  startIcon={<Description />}
                  disabled={submitting || files.length >= MAX_MEDIA_FILES}
                >
                  Choose media
                  <input
                    hidden
                    type="file"
                    accept="image/*,video/*,audio/*"
                    multiple
                    onChange={onPickMedia}
                  />
                </Button>
                {files.length > 0 && (
                  <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    {files.length} file{files.length === 1 ? '' : 's'} selected
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
                      Clear
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
                        +{previews.length - 24} more
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
                    Supplementary files (optional)
                  </Typography>
                  <Chip size="small" label={`max ${MAX_SUPPLEMENTARY_FILES}`} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Protocol notes, PDF, slides, spreadsheets, ZIP, etc. — up to{' '}
                  {Math.round(MAX_SUPPLEMENTARY_BYTES / (1024 * 1024))} MB each.
                </Typography>
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                  startIcon={<AttachFile />}
                  disabled={submitting || supplementary.length >= MAX_SUPPLEMENTARY_FILES}
                >
                  Choose files
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
                      {supplementary.length} file{supplementary.length === 1 ? '' : 's'} selected
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
                        Clear
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

              <Alert severity="info" variant="outlined">
                Best-effort support from the SP-Survey team as capacity allows.
                You can also create an account and build the survey yourself anytime.
              </Alert>

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={submitting}
                sx={{ fontWeight: 700, py: 1.25 }}
              >
                {submitting ? (progress || 'Submitting…') : 'Submit request'}
              </Button>
            </Stack>
          </Box>
        )}
      </Container>

      <PublicFooter />
    </Box>
  );
}
