import React, { useState, useEffect } from 'react';
import {
  Box, Container, Typography, Button, Card, CardContent,
  Chip, TextField, InputAdornment, CircularProgress, Divider,
  Avatar, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Search, Article, Dataset, DesignServices,
  AutoAwesome, BarChart, CloudUpload, Share, Preview, Public, GitHub,
} from '@mui/icons-material';
import { listPublicLiveSurveys, computeLiveStatus } from '../lib/liveSurveyManager';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { projectTemplates } from '../lib/projectTemplates';
import SurveyPreview from '../components/admin/SurveyPreview';
import PublicHeader, { PublicFooter, GITHUB_REPO_URL } from '../components/layout/PublicHeader';
import { useGithubStars } from '../lib/useGithubStars';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';

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

function getStaticTemplates() {
  return projectTemplates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    author: tpl.author,
    year: tpl.year,
    category: normalizeCategory(tpl.category),
    paper_url: null,
    dataset: null,
  }));
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { t } = useRegion();
  const githubStars = useGithubStars();
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
        const { data, error } = await supabase
          .from('templates')
          .select('id, name, description, author, year, category, paper_url, dataset, thumbnail_url, show_on_landing')
          .eq('is_approved', true)
          .order('year', { ascending: false });
        if (!error && data?.length > 0) {
          const normalized = data.map((tpl) => ({
            ...tpl,
            category: normalizeCategory(tpl.category),
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

  const visible = templates.filter((tpl) => {
    const matchesSearch = !hasSearch ||
      [tpl.name, tpl.author, tpl.description, tpl.id].some((v) => v?.toLowerCase().includes(q));
    const shouldShow = hasSearch ? true : (tpl.show_on_landing !== false);
    return matchesSearch && shouldShow;
  });

  const allByCategory = (cat) => templates.filter((tpl) => tpl.category === cat);

  const academic = visible.filter((tpl) => tpl.category === 'academic');
  const urban = visible.filter((tpl) => tpl.category === 'urban');
  const ai = visible.filter((tpl) => tpl.category === 'ai');

  const features = [
    { icon: <CloudUpload color="primary" />, title: t.landFeatUploadTitle, desc: t.landFeatUploadDesc },
    { icon: <AutoAwesome color="secondary" />, title: t.landFeatAiTitle, desc: t.landFeatAiDesc },
    { icon: <Share color="success" />, title: t.landFeatShareTitle, desc: t.landFeatShareDesc },
    { icon: <BarChart color="warning" />, title: t.landFeatResultsTitle, desc: t.landFeatResultsDesc },
  ];

  const categories = [
    { key: 'academic', label: t.landCatAcademic, color: 'success', list: academic },
    { key: 'urban', label: t.landCatUrban, color: 'warning', list: urban },
    { key: 'ai', label: t.landCatAi, color: 'primary', list: ai },
  ];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      {onlineLiveCount > 0 && (
        <Box sx={{ bgcolor: 'success.50', borderBottom: '1px solid', borderColor: 'success.light', py: 1.5, px: 2 }}>
          <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600}>
              {tf(onlineLiveCount === 1 ? t.landLiveBannerOne : t.landLiveBannerMany, { n: onlineLiveCount })}
            </Typography>
            <Button size="small" variant="contained" color="success" startIcon={<Public />} onClick={() => navigate('/live')}>
              {t.landBrowseLive}
            </Button>
          </Container>
        </Box>
      )}

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
            {t.landHeroTitle}
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.88, mb: 0.5, fontWeight: 400, maxWidth: 860, mx: 'auto' }}>
            {t.landHeroLine1}
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.88, mb: 4, fontWeight: 400, maxWidth: 860, mx: 'auto' }}>
            {t.landHeroLine2}
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
            <Button
              variant="contained"
              size="large"
              onClick={() => navigate('/login')}
              sx={{ bgcolor: 'white', color: 'primary.main', fontWeight: 700, px: 4, py: 1.5, '&:hover': { bgcolor: 'grey.100' } }}
            >
              {t.landStartFree}
            </Button>
            <Button
              variant="outlined"
              size="large"
              href="https://www.sciencedirect.com/science/article/pii/S0360132325000514"
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<Article />}
              sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.6)', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' } }}
            >
              {t.landReadPaper}
            </Button>
            <Button
              variant="outlined"
              size="large"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<GitHub />}
              sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.6)', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' } }}
            >
              {githubStars !== null ? `GitHub · ★ ${githubStars}` : 'GitHub'}
            </Button>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Typography variant="h4" fontWeight={700} textAlign="center" sx={{ mb: 5 }}>
          {t.landFeaturesTitle}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 3 }}>
          {features.map((f, i) => (
            <Card
              key={i}
              sx={{
                height: 220,
                borderRadius: 2,
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' },
              }}
            >
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

      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ textAlign: 'center', mb: 5 }}>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
            {t.landTemplatesTitle}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
            {t.landTemplatesSubtitle}
          </Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            justifyContent="center"
            alignItems="center"
          >
            <Button
              variant="outlined"
              startIcon={<Article />}
              onClick={() => navigate('/request-template')}
            >
              {t.landRequestTemplate}
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<DesignServices />}
              onClick={() => navigate('/request-survey-design')}
            >
              {t.landRequestDesign}
            </Button>
          </Stack>
        </Box>

        <TextField
          fullWidth
          placeholder={t.landSearchTemplates}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
          sx={{ mb: 4, maxWidth: 560, mx: 'auto', display: 'block' }}
          size="small"
        />

        {loadingTemplates ? (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <>
            {categories.map(({ key, label, color, list }, idx, arr) => (
              allByCategory(key).length > 0 && (
                <Box key={key} sx={{ mb: idx < arr.length - 1 ? 5 : 0 }}>
                  <Typography variant="h6" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    {label}
                    <Chip label={allByCategory(key).length} size="small" color={color} />
                  </Typography>
                  {list.length > 0 ? (
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                      {list.map((tpl) => (
                        <TemplateCard key={tpl.id} template={tpl} onUse={() => navigate('/login')} />
                      ))}
                    </Box>
                  ) : (
                    !hasSearch && (
                      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                        {tf(t.landSearchCategoryHint, { n: allByCategory(key).length })}
                      </Typography>
                    )
                  )}
                </Box>
              )
            ))}
            {hasSearch && visible.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography color="text.secondary">{tf(t.landNoTemplates, { q: search })}</Typography>
              </Box>
            )}
          </>
        )}
      </Container>

      <Box sx={{ bgcolor: 'primary.main', color: 'white', py: 8, textAlign: 'center' }}>
        <Container maxWidth="sm">
          <Typography variant="h4" fontWeight={700} sx={{ mb: 2 }}>
            {t.landCtaTitle}
          </Typography>
          <Typography sx={{ mb: 4, opacity: 0.88 }}>
            {t.landCtaBody}
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={() => navigate('/login')}
            sx={{ bgcolor: 'white', color: 'primary.main', fontWeight: 700, px: 5, py: 1.5, '&:hover': { bgcolor: 'grey.100' } }}
          >
            {t.landGetStarted}
          </Button>
        </Container>
      </Box>

      <PublicFooter />
    </Box>
  );
}

function TemplatePreviewDialog({ templateId, templateName, open, onClose }) {
  const { t } = useRegion();
  const [config, setConfig] = useState(null);
  const [preloadedImages, setPreloadedImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !templateId) return;
    setConfig(null);
    setPreloadedImages([]);
    setError('');
    setLoading(true);

    const fetchConfig = async () => {
      try {
        if (supabase) {
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
        const res = await fetch(`/project_templates/${templateId}.json`);
        if (res.ok) {
          const tpl = await res.json();
          setConfig(tpl.config || tpl.survey_config || null);
          setPreloadedImages(Array.isArray(tpl.preloadedImages) ? tpl.preloadedImages : []);
        } else {
          setError('Preview not available for this template.');
        }
      } catch {
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
        {tf(t.landPreviewTitle, { name: templateName })}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{t.landReadOnly}</Typography>
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
            showMediaAssignment={false}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.landClose}</Button>
      </DialogActions>
    </Dialog>
  );
}

function TemplateCard({ template, onUse }) {
  const { t } = useRegion();
  const [previewOpen, setPreviewOpen] = useState(false);
  const isAI = template.category === 'ai';
  const isUrban = template.category === 'urban';
  const chipColor = isAI ? 'primary' : isUrban ? 'warning' : 'success';
  const chipLabel = isAI ? t.landChipAi : isUrban ? t.landChipUrban : t.landChipAcademic;

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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0 }}>
            <Chip label={chipLabel} size="small" color={chipColor} variant="outlined" />
            <Typography variant="caption" color="text.secondary">{template.year || ''}</Typography>
          </Box>

          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5, flexShrink: 0, lineHeight: 1.35, ...CLAMP(2) }}>
            {template.name}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, flexShrink: 0, ...CLAMP(1) }}>
            {template.author || '\u00A0'}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, flex: 1, fontSize: '0.8rem', ...CLAMP(2) }}>
            {template.description || ''}
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
            {template.paper_url && (
              <Button size="small" startIcon={<Article />} href={template.paper_url} target="_blank" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.landPaper}
              </Button>
            )}
            {template.dataset && (
              <Button size="small" startIcon={<Dataset />} href={`https://huggingface.co/datasets/${template.dataset}`} target="_blank" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.landDataset}
              </Button>
            )}
            <Button size="small" startIcon={<Preview />} onClick={() => setPreviewOpen(true)} sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
              {t.landPreview}
            </Button>
            <Button size="small" variant="contained" onClick={onUse} sx={{ ml: 'auto', fontSize: '0.75rem' }}>
              {t.landUse}
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
