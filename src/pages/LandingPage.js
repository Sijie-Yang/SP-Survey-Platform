import React, { useState, useEffect } from 'react';
import {
  Box, Container, Typography, Button, Grid, Card, CardContent,
  Chip, TextField, InputAdornment, CircularProgress, Divider,
  Avatar, Stack,
} from '@mui/material';
import {
  Search, Login, GitHub, Article, Dataset,
  AutoAwesome, BarChart, CloudUpload, Share,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { projectTemplates } from '../lib/projectTemplates';

// ── Static fallback templates (from projectTemplates.js) ─────────────────────
function getStaticTemplates() {
  return projectTemplates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    author: t.author,
    year: t.year,
    category: t.category?.toLowerCase().includes('ai') ? 'ai' : 'academic',
    paper_url: null,
    dataset: null,
  }));
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('templates')
          .select('id, name, description, author, year, category, paper_url, dataset, thumbnail_url')
          .eq('is_active', true)
          .order('year', { ascending: false });
        if (!error && data?.length > 0) {
          setTemplates(data);
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

  const filtered = templates.filter(t => {
    const q = search.toLowerCase();
    return !q || [t.name, t.author, t.description, t.id].some(v => v?.toLowerCase().includes(q));
  });

  const academic = filtered.filter(t => t.category !== 'ai');
  const ai = filtered.filter(t => t.category === 'ai');

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#fafafa' }}>

      {/* ── Navbar ── */}
      <Box sx={{ bgcolor: 'white', borderBottom: '1px solid #e0e0e0', px: 3, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <Box component="img" src="/logo-long.png" alt="SP-Survey" sx={{ height: 36, objectFit: 'contain' }} />
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" startIcon={<GitHub />} href="https://github.com/Sijie-Yang/SP-Survey" target="_blank" size="small">
            GitHub
          </Button>
          <Button variant="contained" startIcon={<Login />} onClick={() => navigate('/login')} size="small">
            Sign In
          </Button>
        </Box>
      </Box>

      {/* ── Hero ── */}
      <Box sx={{ bgcolor: 'primary.main', color: 'white', py: { xs: 6, md: 10 }, textAlign: 'center' }}>
        <Container maxWidth="md">
          <Box component="img" src="/logo-long.png" alt="SP-Survey"
            sx={{ height: { xs: 48, md: 64 }, objectFit: 'contain', mb: 3, filter: 'brightness(0) invert(1)' }}
            onError={e => { e.target.style.display = 'none'; }} />
          <Typography variant="h3" fontWeight={800} sx={{ mb: 2, fontSize: { xs: '2rem', md: '2.8rem' } }}>
            Streetscape Perception Survey
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.88, mb: 4, fontWeight: 400, maxWidth: 640, mx: 'auto' }}>
            A research-grade platform for conducting visual perception surveys on urban streetscapes.
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
        <Grid container spacing={3}>
          {[
            { icon: <CloudUpload color="primary" />, title: 'Upload Images', desc: 'Upload street-view images directly to cloud storage. Auto-compressed to keep surveys fast.' },
            { icon: <AutoAwesome color="secondary" />, title: 'AI Survey Builder', desc: 'Describe your research goals and let GPT-4o generate a complete survey with validated question types.' },
            { icon: <Share color="success" />, title: 'Instant Sharing', desc: 'Get a shareable link immediately — no server setup, no deployment, no configuration.' },
            { icon: <BarChart color="warning" />, title: 'Results Analysis', desc: 'View responses per question with image–response pairing and export to CSV.' },
          ].map((f, i) => (
            <Grid item xs={12} sm={6} md={3} key={i}>
              <Card sx={{ height: '100%', borderRadius: 2, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
                <CardContent sx={{ p: 3 }}>
                  <Avatar sx={{ bgcolor: 'grey.100', width: 48, height: 48, mb: 2 }}>{f.icon}</Avatar>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{f.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{f.desc}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      <Divider />

      {/* ── Template Gallery ── */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Box sx={{ textAlign: 'center', mb: 5 }}>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
            📋 Template Library
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
            {academic.length > 0 && (
              <Box sx={{ mb: 5 }}>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  🎓 Academic Research
                  <Chip label={academic.length} size="small" color="success" />
                </Typography>
                <Grid container spacing={2}>
                  {academic.map(t => <TemplateCard key={t.id} template={t} onUse={() => navigate('/login')} />)}
                </Grid>
              </Box>
            )}
            {ai.length > 0 && (
              <Box>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  🤖 AI Generated
                  <Chip label={ai.length} size="small" color="primary" />
                </Typography>
                <Grid container spacing={2}>
                  {ai.map(t => <TemplateCard key={t.id} template={t} onUse={() => navigate('/login')} />)}
                </Grid>
              </Box>
            )}
            {filtered.length === 0 && (
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

      {/* ── Footer ── */}
      <Box sx={{ bgcolor: '#1a1a2e', color: 'grey.400', py: 4, textAlign: 'center' }}>
        <Container>
          <Box component="img" src="/logo-long.png" alt="SP-Survey"
            sx={{ height: 28, objectFit: 'contain', mb: 1.5, filter: 'brightness(0) invert(0.6)' }}
            onError={e => { e.target.style.display = 'none'; }} />
          <Typography variant="body2">
            Developed by{' '}
            <a href="https://ual.sg" target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>
              Urban Analytics Lab, NUS
            </a>
            {' '}·{' '}
            <a href="https://github.com/Sijie-Yang/SP-Survey" target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>
              Open Source (CC BY 4.0)
            </a>
            {' '}·{' '}
            <a href="https://www.sciencedirect.com/science/article/pii/S0360132325000514" target="_blank" rel="noopener noreferrer" style={{ color: '#90caf9' }}>
              Paper
            </a>
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}

function TemplateCard({ template, onUse }) {
  const isAI = template.category === 'ai';
  return (
    <Grid item xs={12} sm={6} md={4}>
      <Card sx={{ height: '100%', borderRadius: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }, transition: 'box-shadow 0.2s' }}>
        <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
            <Chip
              label={isAI ? '🤖 AI' : '🎓 Academic'}
              size="small"
              color={isAI ? 'primary' : 'success'}
              variant="outlined"
            />
            {template.year && <Typography variant="caption" color="text.secondary">{template.year}</Typography>}
          </Box>

          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5, flex: 1 }}>
            {template.name}
          </Typography>

          {template.author && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              {template.author}
            </Typography>
          )}

          {template.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: '0.8rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {template.description}
            </Typography>
          )}

          <Box sx={{ display: 'flex', gap: 1, mt: 'auto', flexWrap: 'wrap' }}>
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
            <Button size="small" variant="contained" onClick={onUse} sx={{ ml: 'auto', fontSize: '0.75rem' }}>
              Use Template
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}
