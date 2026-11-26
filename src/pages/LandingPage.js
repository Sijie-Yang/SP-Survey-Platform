import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Container, Typography, Button, Card, CardContent,
  Chip, CircularProgress, Divider, Avatar, Stack,
} from '@mui/material';
import {
  Article, MenuBook,
  AutoAwesome, BarChart, CloudUpload, Share, Public, GitHub, EmojiEvents,
} from '@mui/icons-material';
import { listPublicLiveSurveys, computeLiveStatus } from '../lib/liveSurveyManager';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { WORKSPACE_PATH, researcherEntryPath, templateUsePath } from '../lib/researcherEntry';
import PublicHeader, { PublicFooter, GITHUB_REPO_URL } from '../components/layout/PublicHeader';
import { useGithubStars } from '../lib/useGithubStars';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';
import { getBenchPublic } from '../lib/spBenchApi';
import StreetscapeAtmosphere from '../components/StreetscapeAtmosphere';
import SiteFeedbackButton from '../components/SiteFeedbackButton';
import {
  isSpSchemeTemplate, SchemeExampleCard, TemplateCard, useTemplateLibrary,
} from '../components/templates/TemplateLibrary';

const CLAMP = (lines) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

// How many templates / SP-Scheme examples the homepage shows; the rest are on /templates.
export const HOME_TEMPLATE_COUNT = 6;
export const HOME_SCHEME_COUNT = 3;

export { isSpSchemeTemplate };

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const workspacePath = researcherEntryPath(!authLoading && isAuthenticated);
  // Templates are listed in the classic editor's sidebar.
  const templatePath = templateUsePath(!authLoading && isAuthenticated);
  const { t } = useRegion();
  const githubStars = useGithubStars();
  const { templates, loading: loadingTemplates } = useTemplateLibrary();
  const [onlineLiveCount, setOnlineLiveCount] = useState(0);
  const [benchSummary, setBenchSummary] = useState(null);
  const heroBgRef = useRef(null);
  const heroContentRef = useRef(null);

  useEffect(() => {
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
    // Write the parallax straight to the DOM: setting state here re-rendered
    // the whole landing page (and generated new CSS classes) every frame.
    let last = -1;
    const apply = (y) => {
      if (y === last) return;
      last = y;
      const bg = heroBgRef.current;
      const content = heroContentRef.current;
      if (bg) {
        // Avoid transform on first paint — Safari often refuses muted autoplay
        // inside a transformed ancestor until a later navigation/gesture.
        bg.style.transform = y > 0 ? `translateY(${y * 0.22}px) scale(${1 + y * 0.00025})` : '';
        bg.style.opacity = y > 0 ? String(Math.max(0.55, 1 - y / 420)) : '';
        bg.style.willChange = y > 0 ? 'transform, opacity' : '';
      }
      if (content) {
        content.style.opacity = String(Math.max(0.75, 1 - y / 520));
        content.style.transform = `translateY(${y * 0.08}px)`;
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        apply(Math.min(220, Math.max(0, window.scrollY)));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // The homepage shows only the newest few; /templates lists all of them.
  const schemeExamples = templates.filter(isSpSchemeTemplate);
  const libraryTemplates = templates.filter((tpl) => !isSpSchemeTemplate(tpl));
  const homeTemplates = libraryTemplates.filter((tpl) => tpl.show_on_landing !== false).slice(0, HOME_TEMPLATE_COUNT);
  const homeSchemes = schemeExamples.slice(0, HOME_SCHEME_COUNT);

  const features = [
    { icon: <CloudUpload color="primary" />, title: t.landFeatUploadTitle, desc: t.landFeatUploadDesc },
    { icon: <AutoAwesome color="secondary" />, title: t.landFeatAiTitle, desc: t.landFeatAiDesc },
    { icon: <Share color="success" />, title: t.landFeatShareTitle, desc: t.landFeatShareDesc },
    { icon: <BarChart color="warning" />, title: t.landFeatResultsTitle, desc: t.landFeatResultsDesc },
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
          ref={heroBgRef}
          sx={{
            position: 'absolute',
            inset: 0,
          }}
        >
          <StreetscapeAtmosphere />
        </Box>
        <Container
          ref={heroContentRef}
          maxWidth="md"
          sx={{
            position: 'relative',
            zIndex: 1,
            py: { xs: 6, md: 10 },
            px: { xs: 2.5, sm: 3 },
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
              onClick={() => navigate(workspacePath)}
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
              {workspacePath === WORKSPACE_PATH ? t.navOpenWorkspace : t.landStartFree}
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={() => navigate('/docs')}
              startIcon={<MenuBook />}
              sx={{
                color: 'white',
                borderColor: 'rgba(255,255,255,0.55)',
                bgcolor: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(8px)',
                '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.14)' },
              }}
            >
              {t.navDocs}
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

      {!loadingTemplates && schemeExamples.length > 0 && (
        <Box sx={{ bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }} data-testid="sp-scheme-gallery">
          <Container maxWidth="lg" sx={{ py: 8 }}>
            <Box sx={{ textAlign: 'center', mb: 4 }}>
              <Chip icon={<AutoAwesome />} label="SP-Scheme" color="secondary" variant="outlined" sx={{ mb: 1.5, fontWeight: 700 }} />
              <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
                {t.landSchemeTitle || 'Surveys designed by AI with SP-Scheme'}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680, mx: 'auto' }}>
                {t.landSchemeSubtitle || 'Each page was designed by a language model from the SP-Scheme spec, then uploaded as the whole survey. Participants get exactly this page; the platform records and analyses the answers. Preview one, or start your own from it.'}
              </Typography>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${Math.min(homeSchemes.length, 3)}, 1fr)` }, gap: 3 }}>
              {homeSchemes.map((tpl) => (
                <SchemeExampleCard key={tpl.id} template={tpl} onUse={() => navigate(templatePath)} />
              ))}
            </Box>
            {schemeExamples.length > homeSchemes.length && (
              <Box sx={{ textAlign: 'center', mt: 4 }}>
                <Button variant="outlined" onClick={() => navigate('/templates?source=ai')}>
                  {tf(t.landSchemeViewAll || 'View all {n} SP-Scheme examples →', { n: schemeExamples.length })}
                </Button>
              </Box>
            )}
          </Container>
        </Box>
      )}

      <Container maxWidth="lg" sx={{ py: 8 }} data-testid="home-template-library">
        <Box sx={{ textAlign: 'center', mb: 5 }}>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
            {t.landTemplatesTitle}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t.landLatestTemplatesSubtitle || t.landTemplatesSubtitle}
          </Typography>
        </Box>

        {loadingTemplates ? (
          <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
            {homeTemplates.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} onUse={() => navigate(templatePath)} />
            ))}
          </Box>
        )}

        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Button variant="contained" size="large" onClick={() => navigate('/templates')} sx={{ fontWeight: 700 }}>
            {loadingTemplates
              ? (t.landViewAllTemplatesShort || 'View all templates →')
              : tf(t.landViewAllTemplates || 'View all {n} templates →', { n: templates.length })}
          </Button>
        </Box>
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
            onClick={() => navigate(workspacePath)}
            sx={{ bgcolor: 'white', color: 'primary.main', fontWeight: 700, px: 5, py: 1.5, '&:hover': { bgcolor: 'grey.100' } }}
          >
            {workspacePath === WORKSPACE_PATH ? t.navOpenWorkspace : t.landGetStarted}
          </Button>
        </Container>
      </Box>

      <PublicFooter />
      <SiteFeedbackButton />
    </Box>
  );
}
