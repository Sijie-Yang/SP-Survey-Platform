import React, { useState, useEffect } from 'react';
import {
  Box, Container, Typography, Button, Card, CardContent,
  Chip, TextField, InputAdornment, CircularProgress, Divider,
  Avatar, Stack, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Search, Article, Dataset, DesignServices,
  AutoAwesome, BarChart, CloudUpload, Share, Preview, Public, GitHub, EmojiEvents,
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
import { getBenchPublic } from '../lib/spBenchApi';
import StreetscapeAtmosphere from '../components/StreetscapeAtmosphere';
import { filterMediaByType, inferMediaType } from '../lib/mediaUtils';
import { listPreviewMedia } from '../lib/previewMediaLibrary';

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

/** Stable hash so the same template keeps the same fallback cover across reloads. */
function hashString(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function collectImageUrls(preloadedImages) {
  if (!Array.isArray(preloadedImages)) return [];
  const urls = [];
  for (const entry of preloadedImages) {
    const url = entry?.url;
    if (!url) continue;
    const type = entry.type || inferMediaType(entry.name || url);
    if (type === 'image') urls.push(url);
  }
  return urls;
}

const DEFAULT_COVER = '/hero/streetscape-poster.jpg';

/**
 * Prefer explicit thumbnail_url → own template library → platform preview media library.
 * Same fallback chain as survey/question preview when a study has no media.
 * Picks are stable per template id so cards don’t reshuffle on every refresh.
 */
function resolveTemplateThumb(template, previewUrls = []) {
  if (template?.thumbnail_url) return template.thumbnail_url;
  const own = collectImageUrls(template?.preloaded_images || template?.preloadedImages);
  const pool = own.length ? own : previewUrls;
  if (!pool.length) return DEFAULT_COVER;
  return pool[hashString(template.id || template.name) % pool.length] || DEFAULT_COVER;
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
  const [benchSummary, setBenchSummary] = useState(null);
  const [heroScroll, setHeroScroll] = useState(0);

  useEffect(() => {
    loadTemplates();
    listPublicLiveSurveys().then((rows) => {
      setOnlineLiveCount(rows.filter((r) => computeLiveStatus(r) === 'online').length);
    }).catch(() => setOnlineLiveCount(0));
    getBenchPublic()
      .then((res) => {
        if (res?.enabled) {
          const top = [...(res.leaderboard || [])]
            .sort((a, b) => (b.overall_score ?? -Infinity) - (a.overall_score ?? -Infinity))
            .slice(0, 3);
          setBenchSummary({ settings: res.settings, top });
        } else {
          setBenchSummary(null);
        }
      })
      .catch(() => setBenchSummary(null));
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setHeroScroll(Math.min(220, Math.max(0, window.scrollY)));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      const previewPoolPromise = listPreviewMedia().catch(() => []);
      if (supabase) {
        // Lightweight first pass — avoid downloading every template's full media catalog.
        const { data, error } = await supabase
          .from('templates')
          .select('id, name, description, author, year, category, paper_url, dataset, thumbnail_url, show_on_landing')
          .eq('is_approved', true)
          .order('year', { ascending: false });
        if (!error && data?.length > 0) {
          const missingIds = data.filter((tpl) => !tpl.thumbnail_url).map((tpl) => tpl.id);
          const libraryById = {};
          const mediaPromise = missingIds.length
            ? supabase.from('templates').select('id, preloaded_images').in('id', missingIds)
            : Promise.resolve({ data: [] });
          const [mediaResult, previewPool] = await Promise.all([mediaPromise, previewPoolPromise]);
          for (const row of mediaResult.data || []) {
            libraryById[row.id] = row.preloaded_images || [];
          }
          const previewUrls = filterMediaByType(previewPool, 'image')
            .map((img) => img.url)
            .filter(Boolean);
          const normalized = data.map((tpl) => {
            const withLibrary = {
              ...tpl,
              preloaded_images: libraryById[tpl.id] || [],
            };
            return {
              id: tpl.id,
              name: tpl.name,
              description: tpl.description,
              author: tpl.author,
              year: tpl.year,
              category: normalizeCategory(tpl.category),
              paper_url: tpl.paper_url,
              dataset: tpl.dataset,
              thumbnail_url: resolveTemplateThumb(withLibrary, previewUrls),
              show_on_landing: tpl.show_on_landing,
            };
          });
          setTemplates(normalized);
          setLoadingTemplates(false);
          return;
        }
      }
      const previewUrls = filterMediaByType(await previewPoolPromise, 'image')
        .map((img) => img.url)
        .filter(Boolean);
      setTemplates(getStaticTemplates().map((tpl) => ({
        ...tpl,
        thumbnail_url: resolveTemplateThumb(tpl, previewUrls),
      })));
    } catch {
      setTemplates(getStaticTemplates().map((tpl) => ({
        ...tpl,
        thumbnail_url: resolveTemplateThumb(tpl),
      })));
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

      <Box
        className="sp-landing-hero"
        sx={{
          position: 'relative',
          color: 'white',
          textAlign: 'center',
          minHeight: { xs: 360, md: 440 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            // Avoid transform on first paint — Safari often refuses muted autoplay
            // inside a transformed ancestor until a later navigation/gesture.
            ...(heroScroll > 0
              ? {
                  transform: `translateY(${heroScroll * 0.22}px) scale(${1 + heroScroll * 0.00025})`,
                  opacity: Math.max(0.55, 1 - heroScroll / 420),
                  willChange: 'transform, opacity',
                }
              : null),
          }}
        >
          <StreetscapeAtmosphere />
        </Box>
        <Container
          maxWidth="md"
          sx={{
            position: 'relative',
            zIndex: 1,
            py: { xs: 6, md: 10 },
            px: { xs: 2.5, sm: 3 },
            opacity: Math.max(0.75, 1 - heroScroll / 520),
            transform: `translateY(${heroScroll * 0.08}px)`,
          }}
        >
          <Box
            component="img"
            className="sp-landing-hero-brand"
            src="/logo-centre.png"
            alt="SP-Survey"
            sx={{
              height: { xs: 100, md: 150 },
              objectFit: 'contain',
              mb: { xs: 2, md: 3 },
              filter: 'drop-shadow(0 8px 28px rgba(0,0,0,0.35))',
            }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <Typography
            className="sp-landing-hero-title"
            component="h1"
            sx={{
              mb: 1.5,
              fontWeight: 800,
              fontSize: { xs: '1.9rem', sm: '2.4rem', md: '2.8rem' },
              letterSpacing: '-0.03em',
              lineHeight: 1.12,
              textShadow: '0 2px 28px rgba(0,0,0,0.45)',
            }}
          >
            {t.landHeroTitle}
          </Typography>
          <Typography
            className="sp-landing-hero-sub"
            sx={{
              opacity: 0.92,
              mb: 3.5,
              fontWeight: 400,
              fontSize: { xs: '1rem', md: '1.15rem' },
              maxWidth: 560,
              mx: 'auto',
              lineHeight: 1.55,
              textShadow: '0 1px 16px rgba(0,0,0,0.4)',
            }}
          >
            {t.landHeroLine2}
          </Typography>

          <Stack
            className="sp-landing-hero-cta"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.75}
            justifyContent="center"
            alignItems="center"
          >
            <Button
              variant="contained"
              size="large"
              onClick={() => navigate('/login')}
              sx={{
                bgcolor: 'rgba(255,255,255,0.96)',
                color: '#0f2a22',
                fontWeight: 700,
                px: 4,
                py: 1.5,
                boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                '&:hover': { bgcolor: '#fff' },
              }}
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
              sx={{
                color: 'white',
                borderColor: 'rgba(255,255,255,0.55)',
                bgcolor: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(8px)',
                '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.14)' },
              }}
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
              sx={{
                color: 'white',
                borderColor: 'rgba(255,255,255,0.55)',
                bgcolor: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(8px)',
                '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.14)' },
              }}
            >
              {githubStars !== null ? `GitHub · ★ ${githubStars}` : 'GitHub'}
            </Button>
          </Stack>
        </Container>
      </Box>

      {benchSummary && (
        <Box
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'grey.50',
            py: 1.25,
            px: 2,
          }}
        >
          <Container
            maxWidth="lg"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <EmojiEvents fontSize="small" color="warning" />
              <Typography variant="subtitle2" fontWeight={800} noWrap>
                {benchSummary.settings?.title || t.navSpBench || 'SP-Bench'}
              </Typography>
              <Chip size="small" variant="outlined" label={benchSummary.settings?.method_version || 'v1'} />
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ display: { xs: 'none', md: 'flex' } }}>
                {benchSummary.top.slice(0, 3).map((row, idx) => (
                  <Chip
                    key={row.run_id || idx}
                    size="small"
                    variant="outlined"
                    label={`#${idx + 1} ${row.model_name}${row.overall_score != null ? ` · ${Number(row.overall_score).toFixed(2)}` : ''}`}
                  />
                ))}
              </Stack>
            </Stack>
            <Button size="small" variant="text" onClick={() => navigate('/bench')} sx={{ fontWeight: 700 }}>
              {t.benchViewLeaderboard || 'View leaderboard'} →
            </Button>
          </Container>
        </Box>
      )}

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
  const [thumbFailed, setThumbFailed] = useState(false);
  const isAI = template.category === 'ai';
  const isUrban = template.category === 'urban';
  const chipColor = isAI ? 'primary' : isUrban ? 'warning' : 'success';
  const chipLabel = isAI ? t.landChipAi : isUrban ? t.landChipUrban : t.landChipAcademic;
  const resolvedThumb = template.thumbnail_url || resolveTemplateThumb(template) || DEFAULT_COVER;
  const thumb = thumbFailed ? DEFAULT_COVER : resolvedThumb;
  const coverPos = `${hashString(template.id) % 80}% ${hashString(`${template.id}-y`) % 80}%`;

  useEffect(() => {
    setThumbFailed(false);
  }, [resolvedThumb]);

  return (
    <>
      <Card sx={{
        height: 258,
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' },
        transition: 'box-shadow 0.2s',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Box
          sx={{
            height: 110,
            flexShrink: 0,
            bgcolor: 'grey.100',
            backgroundImage: `url(${thumb})`,
            backgroundSize: 'cover',
            backgroundPosition: coverPos,
            position: 'relative',
          }}
        >
          <Box
            component="img"
            src={thumb}
            alt=""
            onError={() => {
              if (thumb !== DEFAULT_COVER) setThumbFailed(true);
            }}
            sx={{ display: 'none' }}
          />
          <Chip
            label={chipLabel}
            size="small"
            color={chipColor}
            variant="outlined"
            sx={{
              position: 'absolute',
              top: 10,
              left: 10,
              bgcolor: 'rgba(255,255,255,0.94)',
              fontWeight: 600,
              // Filled chips use contrast (white) text; white bg made that invisible.
              borderColor: `${chipColor}.main`,
              color: `${chipColor}.dark`,
            }}
          />
        </Box>
        <CardContent sx={{ p: 2, flex: 1, minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.35, flexShrink: 0, lineHeight: 1.35, ...CLAMP(2) }}>
            {template.name}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, flexShrink: 0, ...CLAMP(1) }}>
            {[template.author, template.year].filter(Boolean).join(' · ') || '\u00A0'}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, flex: 1, fontSize: '0.8rem', lineHeight: 1.4, ...CLAMP(1) }}>
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
