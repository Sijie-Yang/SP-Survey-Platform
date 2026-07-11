import React, { useState, useEffect } from 'react';
import {
  Box, Container, Typography, Button, Card, CardContent,
  Chip, TextField, InputAdornment, CircularProgress, Divider,
  Avatar, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Search, Article, Dataset,
  AutoAwesome, BarChart, CloudUpload, Share, Preview, Public,
} from '@mui/icons-material';
import { listPublicLiveSurveys, computeLiveStatus } from '../lib/liveSurveyManager';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { projectTemplates } from '../lib/projectTemplates';
import SurveyPreview from '../components/admin/SurveyPreview';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';

const CLAMP = (lines) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

function normalizeCategory(raw) {
  const c = raw?.toLowerCase() || '';
  if (c.includes('ai')) return 'ai';
  if (c.includes('urban')) return 'urban';
  return 'academic';
}

// ── Static fallback templates (from projectTemplates.js) ─────────────────────
function getStaticTemplates() {
  return projectTemplates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    author: t.author,
    year: t.year,
    category: normalizeCategory(t.category),
    paper_url: null,
    dataset: null,
  }));
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [search, setSearch] = useState('');
  const [onlineLiveCount, setOnlineLiveCount] = useState(0);

  useEffect(() => {
    loadTemplates();
    listPublicLiveSurveys().then((rows) => {
      setOnlineLiveCount(rows.filter((r) => computeLiveStatus(r) === 'online').length);
    }).catch(() => setOnlineLiveCount(0));
  }, []);

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      if (supabase) {
        // Fetch ALL approved templates; show_on_landing controls default display
        const { data, error } = await supabase
          .from('templates')
          .select('id, name, description, author, year, category, paper_url, dataset, thumbnail_url, show_on_landing')
          .eq('is_approved', true)
          .order('year', { ascending: false });
        if (!error && data?.length > 0) {
          const normalized = data.map(t => ({
            ...t,
            category: normalizeCategory(t.category),
          }));
          setTemplates(normalized);
          setLoadingTemplates(false);
          return;
        }
      }
      setTemplates(getStaticTemplates());
    } catch {
      setTemplates(getStaticTemplates());
    } finally {
      setLoadingTemplates(false);
    }
  }

  const hasSearch = search.trim().length > 0;
  const q = search.toLowerCase();

  // When searching: show all matching approved templates
  // When not searching: only show templates marked show_on_landing
  const visible = templates.filter(t => {
    const matchesSearch = !hasSearch ||
      [t.name, t.author, t.description, t.id].some(v => v?.toLowerCase().includes(q));
    const shouldShow = hasSearch ? true : (t.show_on_landing !== false);
    return matchesSearch && shouldShow;
  });

  // Counts always reflect ALL templates in each category (ignore show_on_landing)
  const allByCategory = (cat) => templates.filter(t => t.category === cat);

  const academic = visible.filter(t => t.category === 'academic');
  const urban    = visible.filter(t => t.category === 'urban');
  const ai       = visible.filter(t => t.category === 'ai');

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      {/* ── Live Surveys teaser ── */}
      {onlineLiveCount > 0 && (
        <Box sx={{ bgcolor: 'success.50', borderBottom: '1px solid', borderColor: 'success.light', py: 1.5, px: 2 }}>
          <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600}>
              {onlineLiveCount} live {onlineLiveCount === 1 ? 'survey is' : 'surveys are'} online now — take them as a participant.
            </Typography>
            <Button size="small" variant="contained" color="success" startIcon={<Public />} onClick={() => navigate('/live')}>
              Browse Live Surveys
            </Button>
          </Container>
        </Box>
      )}

      {/* ── Hero ── */}
      <Box sx={{ bgcolor: 'primary.main', color: 'white', py: { xs: 6, md: 10 }, textAlign: 'center' }}>
        <Container maxWidth="md">
          <Box
            component="img"
            src="/logo-centre.png"
            alt="SP-Survey"
            sx={{ height: { xs: 120, md: 180 }, objectFit: 'contain', mb: 3 }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <Typography variant="h3" fontWeight={800} sx={{ mb: 2, fontSize: { xs: '2rem', md: '2.8rem' }, letterSpacing: '-0.02em' }}>
            Streetscape Perception Survey
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.88, mb: 0.5, fontWeight: 400, maxWidth: 860, mx: 'auto' }}>
            A research-grade platform for conducting visual perception surveys on urban streetscapes.
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.88, mb: 4, fontWeight: 400, maxWidth: 860, mx: 'auto' }}>
            No coding required — build, share, and analyze in minutes.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
            <Button
              variant="contained"
              size="large"
              onClick={() => navigate('/login')}
              sx={{ bgcolor: 'white', color: 'primary.main', fontWeight: 700, px: 4, py: 1.5, '&:hover': { bgcolor: 'grey.100' } }}
            >
              Start for Free →
            </Button>
            <Button
              variant="outlined"
              size="large"
              href="https://www.sciencedirect.com/science/article/pii/S0360132325000514"
              target="_blank"
              startIcon={<Article />}
              sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.6)', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' } }}
            >
              Read Paper
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* ── Feature Cards ── */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Typography variant="h4" fontWeight={700} textAlign="center" sx={{ mb: 5 }}>
          Everything you need for perception research
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 3 }}>
          {[
            { icon: <CloudUpload color="primary" />, title: 'Upload Images', desc: 'Upload street-view images directly to cloud storage. Auto-compressed to keep surveys fast.' },
            { icon: <AutoAwesome color="secondary" />, title: 'AI Survey Builder', desc: 'Describe your research goals and let GPT-4o generate a complete survey with validated question types.' },
            { icon: <Share color="success" />, title: 'Instant Sharing', desc: 'Get a shareable link immediately — no server setup, no deployment, no configuration.' },
            { icon: <BarChart color="warning" />, title: 'Results Analysis', desc: 'View responses per question with image–response pairing and export to CSV.' },
          ].map((f, i) => (
            <Card key={i} sx={{
              height: 220,
              borderRadius: 2,
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              transition: 'box-shadow 0.2s',
              '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' },
            }}>
              <CardContent sx={{ p: 3, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                <Avatar sx={{ bgcolor: 'grey.100', width: 40, height: 40, mb: 1.5, flexShrink: 0 }}>{f.icon}</Avatar>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5, flexShrink: 0 }}>{f.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ ...CLAMP(3) }}>{f.desc}</Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>

      <Divider />

      {/* ── Template Gallery ── */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ textAlign: 'center', mb: 5 }}>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
            Template Library
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Start from peer-reviewed survey designs used in published research
          </Typography>
        </Box>

        <TextField
          fullWidth
          placeholder="Search templates by name, author, or topic..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
          sx={{ mb: 4, maxWidth: 560, mx: 'auto', display: 'block' }}
          size="small"
        />

        {loadingTemplates ? (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <>
            {[
              { key: 'academic', label: 'Academic Research', color: 'success', list: academic },
              { key: 'urban',    label: 'Urban Theory',      color: 'warning', list: urban },
              { key: 'ai',       label: 'AI Generated',      color: 'primary', list: ai },
            ].map(({ key, label, color, list }, idx, arr) => (
              allByCategory(key).length > 0 && (
                <Box key={key} sx={{ mb: idx < arr.length - 1 ? 5 : 0 }}>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    {label}
                    {/* total count for this category */}
                    <Chip label={allByCategory(key).length} size="small" color={color} />
                  </Typography>
                  {list.length > 0 ? (
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                      {list.map(t => <TemplateCard key={t.id} template={t} onUse={() => navigate('/login')} />)}
                    </Box>
                  ) : (
                    !hasSearch && (
                      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                        Search to explore all {allByCategory(key).length} template{allByCategory(key).length !== 1 ? 's' : ''} in this category.
                      </Typography>
                    )
                  )}
                </Box>
              )
            ))}
            {hasSearch && visible.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography color="text.secondary">No templates found for "{search}"</Typography>
              </Box>
            )}
          </>
        )}
      </Container>

      {/* ── CTA ── */}
      <Box sx={{ bgcolor: 'primary.main', color: 'white', py: 8, textAlign: 'center' }}>
        <Container maxWidth="sm">
          <Typography variant="h4" fontWeight={700} sx={{ mb: 2 }}>
            Ready to start your survey?
          </Typography>
          <Typography sx={{ mb: 4, opacity: 0.88 }}>
            Create an account and launch your first survey in under 10 minutes.
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={() => navigate('/login')}
            sx={{ bgcolor: 'white', color: 'primary.main', fontWeight: 700, px: 5, py: 1.5, '&:hover': { bgcolor: 'grey.100' } }}
          >
            Get Started Free
          </Button>
        </Container>
      </Box>

      <PublicFooter />
    </Box>
  );
}

// ── Template Preview Dialog ──────────────────────────────────────────────────

function TemplatePreviewDialog({ templateId, templateName, open, onClose }) {
  const [config, setConfig]               = useState(null);
  const [preloadedImages, setPreloadedImages] = useState([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');

  useEffect(() => {
    if (!open || !templateId) return;
    setConfig(null);
    setPreloadedImages([]);
    setError('');
    setLoading(true);

    const fetchConfig = async () => {
      try {
        if (supabase) {
          // Also pull preloaded_images so SurveyPreview can render the
          // template's own image folder, just like the admin preview does.
          const { data, error: err } = await supabase
            .from('templates')
            .select('survey_config, preloaded_images')
            .eq('id', templateId)
            .single();
          if (!err && data?.survey_config) {
            setConfig(data.survey_config);
            setPreloadedImages(Array.isArray(data.preloaded_images) ? data.preloaded_images : []);
            return;
          }
        }
        // Fallback: try static local file
        const res = await fetch(`/project_templates/${templateId}.json`);
        if (res.ok) {
          const tpl = await res.json();
          setConfig(tpl.config || tpl.survey_config || null);
          setPreloadedImages(Array.isArray(tpl.preloadedImages) ? tpl.preloadedImages : []);
        } else {
          setError('Preview not available for this template.');
        }
      } catch (e) {
        setError('Failed to load preview.');
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [open, templateId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle>
        Preview — {templateName}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>(read-only)</Typography>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Box sx={{ p: 3 }}>
            <Typography color="text.secondary">{error}</Typography>
          </Box>
        )}
        {config && !loading && (
          <SurveyPreview
            config={config}
            currentProject={{
              id: `tpl-${templateId}`,
              name: templateName,
              preloadedImages,
            }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({ template, onUse }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isAI     = template.category === 'ai';
  const isUrban  = template.category === 'urban';
  const chipColor = isAI ? 'primary' : isUrban ? 'warning' : 'success';
  const chipLabel = isAI ? 'AI' : isUrban ? 'Urban' : 'Academic';

  return (
    <>
    <Card sx={{
      height: 220,
      borderRadius: 2,
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' },
      transition: 'box-shadow 0.2s',
    }}>
      <CardContent sx={{ p: 2.5, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {/* Row 1: category chip + year */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
          <Chip label={chipLabel} size="small" color={chipColor} variant="outlined" />
          <Typography variant="caption" color="text.secondary">{template.year || ''}</Typography>
        </Box>

        {/* Row 2: title — fixed 2 lines */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5, flexShrink: 0, lineHeight: 1.35, ...CLAMP(2) }}>
          {template.name}
        </Typography>

        {/* Row 3: author — fixed 1 line */}
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, flexShrink: 0, ...CLAMP(1) }}>
          {template.author || '\u00A0'}
        </Typography>

        {/* Row 4: description — fills remaining space, clamped to 2 lines */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, flex: 1, fontSize: '0.8rem', ...CLAMP(2) }}>
          {template.description || ''}
        </Typography>

        {/* Row 5: action buttons */}
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          {template.paper_url && (
            <Button size="small" startIcon={<Article />} href={template.paper_url} target="_blank" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
              Paper
            </Button>
          )}
          {template.dataset && (
            <Button size="small" startIcon={<Dataset />} href={`https://huggingface.co/datasets/${template.dataset}`} target="_blank" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
              Dataset
            </Button>
          )}
          <Button size="small" startIcon={<Preview />} onClick={() => setPreviewOpen(true)} sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
            Preview
          </Button>
          <Button size="small" variant="contained" onClick={onUse} sx={{ ml: 'auto', fontSize: '0.75rem' }}>
            Use
          </Button>
        </Box>
      </CardContent>
    </Card>

    <TemplatePreviewDialog
      templateId={template.id}
      templateName={template.name}
      open={previewOpen}
      onClose={() => setPreviewOpen(false)}
    />
    </>
  );
}
