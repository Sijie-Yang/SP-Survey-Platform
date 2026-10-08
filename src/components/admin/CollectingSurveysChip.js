import React from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

/** Same toolbar chip family as 「任务 · N 运行中」. */
const chipSx = {
  ml: 0.5,
  px: 1.25,
  py: 0.35,
  minWidth: 0,
  fontWeight: 700,
  textTransform: 'none',
  border: '1px solid',
  borderColor: 'rgba(255, 255, 255, 0.65)',
  bgcolor: 'rgba(255, 255, 255, 0.12)',
  '&:hover': {
    borderColor: 'rgba(255, 255, 255, 0.95)',
    bgcolor: 'rgba(255, 255, 255, 0.22)',
  },
};

export default function CollectingSurveysChip({ count = 0, onClick }) {
  const { t } = useRegion();
  const label = tf(t.collectingSurveysBadge, { count });
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Tooltip title={t.collectingSurveysTitle}>
        <Button
          color="inherit"
          size="small"
          onClick={onClick}
          data-testid="collecting-surveys-chip"
          aria-label={label}
          sx={chipSx}
        >
          {label}
        </Button>
      </Tooltip>
    </Box>
  );
}
