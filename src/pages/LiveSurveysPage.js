import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Container, Typography, Button, Card, CardContent, Chip,
  CircularProgress, Alert, Divider,
} from '@mui/material';
import { Public, Schedule } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import {
  listPublicLiveSurveys,
  computeLiveStatus,
  formatLiveWindow,
} from '../lib/liveSurveyManager';

function LiveCard({ listing }) {
  const navigate = useNavigate();
  const phase = computeLiveStatus(listing);
  const online = phase === 'online';
  const upcoming = phase === 'upcoming';

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        opacity: online ? 1 : 0.55,
        filter: online ? 'none' : 'grayscale(0.85)',
        bgcolor: online ? 'background.paper' : 'grey.100',
        borderColor: online ? 'primary.light' : 'divider',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s',
        '&:hover': online ? { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' } : undefined,
      }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip
            size="small"
            label={online ? 'Online' : upcoming ? 'Upcoming' : 'Closed'}
            color={online ? 'success' : upcoming ? 'info' : 'default'}
          />
          {listing.category && (
            <Chip size="small" variant="outlined" label={listing.category} />
          )}
        </Box>
        <Typography variant="h6" fontWeight={700}>
          {listing.title}
        </Typography>
        {listing.author && (
          <Typography variant="body2" color="text.secondary">
            {listing.author}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {listing.description || 'No description provided.'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Schedule fontSize="inherit" />
          {formatLiveWindow(listing.online_start, listing.online_end)}
        </Typography>
        <Button
          variant={online ? 'contained' : 'outlined'}
          disabled={!online}
          startIcon={<Public />}
          onClick={() => navigate(`/survey?project=${encodeURIComponent(listing.project_id)}`)}
        >
          {online ? 'Take survey' : upcoming ? 'Not open yet' : 'Closed'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function LiveSurveysPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await listPublicLiveSurveys();
      if (!cancelled) {
        setListings(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { online, rest } = useMemo(() => {
    const onlineList = [];
    const other = [];
    for (const l of listings) {
      if (computeLiveStatus(l) === 'online') onlineList.push(l);
      else other.push(l);
    }
    other.sort((a, b) => {
      const pa = computeLiveStatus(a);
      const pb = computeLiveStatus(b);
      if (pa === pb) return new Date(b.online_end || 0) - new Date(a.online_end || 0);
      if (pa === 'upcoming') return -1;
      if (pb === 'upcoming') return 1;
      return 0;
    });
    return { online: onlineList, rest: other };
  }, [listings]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      <Container maxWidth="lg" sx={{ py: 5, flex: 1 }}>
        <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
          Live Surveys
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 720 }}>
          Community studies currently featured by the platform. While online, participant links always
          load the researcher&apos;s latest project — not a frozen snapshot. Grey cards are outside
          their approved time window.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : listings.length === 0 ? (
          <Alert severity="info">
            No live surveys are featured yet. Researchers can apply from their project menu
            (Publish to Main Page); admins approve listings on the admin dashboard.
          </Alert>
        ) : (
          <>
            {online.length > 0 && (
              <Box sx={{ mb: 5 }}>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
                  Now online ({online.length})
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                    gap: 2,
                  }}
                >
                  {online.map((l) => <LiveCard key={l.id} listing={l} />)}
                </Box>
              </Box>
            )}

            {rest.length > 0 && (
              <Box>
                <Divider sx={{ mb: 3 }} />
                <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
                  Upcoming & closed
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                    gap: 2,
                  }}
                >
                  {rest.map((l) => <LiveCard key={l.id} listing={l} />)}
                </Box>
              </Box>
            )}
          </>
        )}
      </Container>

      <PublicFooter />
    </Box>
  );
}
