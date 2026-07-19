import React from 'react';
import {
  Box, Container, Typography, Link, Avatar, Stack, Chip,
} from '@mui/material';
import { OpenInNew } from '@mui/icons-material';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';

/**
 * Team roster from the SP-Survey paper author list.
 * Affiliation numbers match \affilnum{}. Texts follow UAL / known co-appointments.
 */
const AFFILIATIONS = [
  { num: 1, text: 'Department of Architecture, National University of Singapore, Singapore' },
  { num: 2, text: 'Future Cities Lab Global, Singapore-ETH Centre, Singapore' },
  { num: 4, text: 'School of Architecture, Tsinghua University, Beijing, China' },
  { num: 5, text: 'Department of Geosciences and Geography, University of Helsinki, Finland' },
  { num: 6, text: 'Department of Real Estate, National University of Singapore, Singapore' },
];

const LEAD = {
  name: 'Sijie Yang',
  role: 'PhD Researcher',
  projectRole: 'Project Lead',
  blurb:
    'Initiated and leads the design, development, and open release of SP-Survey — from platform architecture and survey tooling to the hosted research workflow.',
  affils: [1],
  url: 'https://ual.sg/author/sijie-yang/',
  photo: '/team/sijie-yang.jpg',
};

const COLLABORATORS = [
  {
    name: 'Xiucheng Liang',
    role: 'PhD Researcher',
    affils: [1],
    url: 'https://ual.sg/author/xiucheng-liang/',
    photo: '/team/xiucheng-liang.jpg',
  },
  {
    name: 'Youlong Gu',
    role: 'Research Engineer',
    affils: [1],
    url: 'https://ual.sg/author/youlong-gu/',
    photo: '/team/youlong-gu.jpg',
  },
  {
    name: 'Matias Quintana',
    role: 'Research Fellow',
    affils: [2],
    url: 'https://ual.sg/author/matias-quintana/',
    photo: '/team/matias-quintana.jpeg',
  },
  {
    name: 'Koichi Ito',
    role: 'PhD Researcher',
    affils: [1, 3],
    url: 'https://ual.sg/author/koichi-ito/',
    photo: '/team/koichi-ito.jpg',
  },
  {
    name: 'Jiatong Li',
    role: 'Visiting Scholar',
    affils: [1, 4],
    url: 'https://ual.sg/author/jiatong-li/',
    photo: '/team/jiatong-li.jpg',
  },
  {
    name: 'Jussi Torkko',
    role: 'Visiting Scholar',
    affils: [1, 5],
    url: 'https://ual.sg/author/jussi-torkko/',
    photo: '/team/jussi-torkko.jpg',
  },
  {
    name: 'Zicheng Fan',
    role: 'PhD Researcher',
    affils: [1],
    url: 'https://ual.sg/author/zicheng-fan/',
    photo: '/team/zicheng-fan.jpg',
  },
];

const PI = {
  name: 'Filip Biljecki',
  role: 'Associate Professor',
  projectRole: 'Principal Investigator',
  blurb:
    'Founder of the Urban Analytics Lab; provides academic supervision and research direction for SP-Survey.',
  affils: [1, 6],
  url: 'https://ual.sg/author/filip-biljecki/',
  photo: '/team/filip-biljecki.jpg',
};

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function AffilNums({ nums }) {
  return (
    <Typography
      component="sup"
      variant="caption"
      color="text.secondary"
      sx={{ ml: 0.25, fontWeight: 600, letterSpacing: 0.3 }}
    >
      {nums.join(',')}
    </Typography>
  );
}

function MemberCard({ member }) {
  return (
    <Box
      sx={{
        p: 2.5,
        height: '100%',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s, border-color 0.2s',
        '&:hover': {
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          borderColor: 'primary.light',
        },
      }}
    >
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <Avatar
          src={member.photo}
          alt={member.name}
          sx={{
            width: 56,
            height: 56,
            bgcolor: 'primary.main',
            fontWeight: 700,
            fontSize: '1rem',
            flexShrink: 0,
          }}
        >
          {initials(member.name)}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} component="div">
            {member.name}
            <AffilNums nums={member.affils} />
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            {member.role}
          </Typography>
          <Link
            href={member.url}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            variant="caption"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.4,
              fontWeight: 600,
            }}
          >
            Profile
            <OpenInNew sx={{ fontSize: 12 }} />
          </Link>
        </Box>
      </Stack>
    </Box>
  );
}

function FeaturedCard({ member, accent = 'primary' }) {
  const isPrimary = accent === 'primary';
  return (
    <Box
      sx={{
        p: { xs: 2.5, sm: 3 },
        height: '100%',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: isPrimary ? 'primary.main' : 'divider',
        borderRadius: 2,
        boxShadow: isPrimary
          ? '0 4px 20px rgba(25, 118, 210, 0.12)'
          : '0 2px 8px rgba(0,0,0,0.04)',
      }}
    >
      <Stack spacing={2} alignItems="flex-start">
        <Avatar
          src={member.photo}
          alt={member.name}
          sx={{
            width: 72,
            height: 72,
            bgcolor: isPrimary ? 'primary.main' : 'grey.700',
            fontWeight: 700,
            fontSize: '1.35rem',
            flexShrink: 0,
          }}
        >
          {initials(member.name)}
        </Avatar>
        <Box sx={{ minWidth: 0, width: '100%' }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
            <Chip
              size="small"
              label={member.projectRole}
              color={isPrimary ? 'primary' : 'default'}
              sx={{ fontWeight: 700 }}
            />
            <Typography variant="body2" color="text.secondary">
              {member.role}
            </Typography>
          </Stack>
          <Typography variant="h5" fontWeight={800} component="div" sx={{ mb: 1 }}>
            {member.name}
            <AffilNums nums={member.affils} />
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {member.blurb}
          </Typography>
          <Link
            href={member.url}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            variant="body2"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              fontWeight: 600,
            }}
          >
            Profile
            <OpenInNew sx={{ fontSize: 14 }} />
          </Link>
        </Box>
      </Stack>
    </Box>
  );
}

function SectionTitle({ children }) {
  return (
    <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
      {children}
    </Typography>
  );
}

export default function TeamPage() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      <Container maxWidth="lg" sx={{ py: 5, flex: 1 }}>
        <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
          Team
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 720 }}>
          SP-Survey is led by{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Sijie Yang
          </Box>
          {' '}at the{' '}
          <Link href="https://ual.sg" target="_blank" rel="noopener noreferrer" fontWeight={600}>
            Urban Analytics Lab
          </Link>
          , National University of Singapore, with collaborators across partner institutions and supervised by Filip Biljecki.
        </Typography>

        <Stack
          direction="row"
          spacing={{ xs: 2, sm: 3 }}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 4 }}
        >
          <Box
            component="a"
            href="https://ual.sg"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Urban Analytics Lab, NUS"
            sx={{ display: 'inline-flex', lineHeight: 0 }}
          >
            <Box
              component="img"
              src="/UAL%20Logo.jpg"
              alt="Urban Analytics Lab, NUS"
              sx={{ height: { xs: 48, sm: 56 }, objectFit: 'contain', display: 'block' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </Box>
          <Box
            component="img"
            src="/DoA%20Logo.jpg"
            alt="Department of Architecture, NUS"
            sx={{ height: { xs: 48, sm: 56 }, objectFit: 'contain', display: 'block' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 2,
            mb: 5,
            alignItems: 'stretch',
          }}
        >
          <FeaturedCard member={LEAD} accent="primary" />
          <FeaturedCard member={PI} accent="neutral" />
        </Box>

        <Box sx={{ mb: 5 }}>
          <SectionTitle>Collaborators</SectionTitle>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: '1fr 1fr',
                md: '1fr 1fr 1fr',
              },
              gap: 2,
            }}
          >
            {COLLABORATORS.map((m) => (
              <MemberCard key={m.name} member={m} />
            ))}
          </Box>
        </Box>

        <Box
          sx={{
            pt: 3,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
            Affiliations
          </Typography>
          <Stack spacing={0.75}>
            {AFFILIATIONS.map((a) => (
              <Typography key={a.num} variant="body2" color="text.secondary">
                <Box component="span" sx={{ fontWeight: 700, color: 'text.primary', mr: 0.75 }}>
                  {a.num}
                </Box>
                {a.text}
              </Typography>
            ))}
          </Stack>
        </Box>
      </Container>

      <PublicFooter />
    </Box>
  );
}
