import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, Paper, Stack, Typography,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';
import {
  getPublicNewsPostBySlug,
  listPublicNewsPosts,
  localizeNewsPost,
} from '../lib/newsPostStore';

function formatDate(iso, language) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function NewsList({ posts, language, t }) {
  if (!posts.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
        {t.newsEmpty}
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      {posts.map((raw) => {
        const post = localizeNewsPost(raw, language);
        return (
          <Paper
            key={post.id}
            component={RouterLink}
            to={`/news/${encodeURIComponent(post.slug)}`}
            variant="outlined"
            sx={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              p: { xs: 2, sm: 2.5 },
              transition: 'border-color 0.15s, background-color 0.15s',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
            }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {post.coverUrl && (
                <Box
                  component="img"
                  src={post.coverUrl}
                  alt=""
                  sx={{
                    width: { xs: '100%', sm: 160 },
                    height: { xs: 140, sm: 100 },
                    objectFit: 'cover',
                    borderRadius: 1,
                    flexShrink: 0,
                    bgcolor: 'grey.100',
                  }}
                />
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(post.publishedAt || post.createdAt, language)}
                </Typography>
                <Typography variant="h6" fontWeight={700} sx={{ mt: 0.25, mb: 0.75 }}>
                  {post.title}
                </Typography>
                {post.summary && (
                  <Typography variant="body2" color="text.secondary">
                    {post.summary}
                  </Typography>
                )}
              </Box>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

function NewsDetail({ post, language, t, onBack }) {
  const localized = localizeNewsPost(post, language);
  return (
    <Box>
      <Button startIcon={<ArrowBack />} onClick={onBack} sx={{ mb: 2 }}>
        {t.newsBackToList}
      </Button>
      {localized.coverUrl && (
        <Box
          component="img"
          src={localized.coverUrl}
          alt=""
          sx={{
            width: '100%',
            maxHeight: 360,
            objectFit: 'cover',
            borderRadius: 2,
            mb: 3,
            bgcolor: 'grey.100',
          }}
        />
      )}
      <Chip
        size="small"
        label={formatDate(localized.publishedAt || localized.createdAt, language)}
        sx={{ mb: 1.5 }}
      />
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1.5, letterSpacing: '-0.02em' }}>
        {localized.title}
      </Typography>
      {localized.summary && (
        <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
          {localized.summary}
        </Typography>
      )}
      <Typography
        variant="body1"
        sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.75, color: 'text.primary' }}
      >
        {localized.body || t.newsNoBody}
      </Typography>
    </Box>
  );
}

export default function NewsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t, language } = useRegion();
  const [posts, setPosts] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [missingTable, setMissingTable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setMissingTable(false);
    try {
      if (slug) {
        const post = await getPublicNewsPostBySlug(decodeURIComponent(slug));
        setDetail(post);
        setPosts([]);
        if (!post) setError(t.newsNotFound);
      } else {
        const list = await listPublicNewsPosts();
        setPosts(list);
        setDetail(null);
      }
    } catch (err) {
      setPosts([]);
      setDetail(null);
      if (err?.missingTable) setMissingTable(true);
      else setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [slug, t.newsNotFound]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'grey.50' }}>
      <PublicHeader />
      <Container maxWidth="md" sx={{ py: { xs: 4, sm: 6 }, flex: 1 }}>
        <Typography variant="h4" fontWeight={800} sx={{ mb: 1, letterSpacing: '-0.02em' }}>
          {t.newsTitle}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          {t.newsSubtitle}
        </Typography>

        {missingTable && (
          <Alert severity="info" sx={{ mb: 2 }}>{t.newsUnavailable}</Alert>
        )}
        {error && !missingTable && (
          <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : slug ? (
          detail ? (
            <NewsDetail
              post={detail}
              language={language}
              t={t}
              onBack={() => navigate('/news')}
            />
          ) : null
        ) : (
          <NewsList posts={posts} language={language} t={t} />
        )}
      </Container>
      <PublicFooter />
    </Box>
  );
}
