import React from 'react';
import { Box, Paper, Typography, Stack, Chip } from '@mui/material';
import { summarizeSkillAnswer } from '../lib/skillAnswerSummary';

/** Read-only review of a skill answer (preview-before-complete / results). */
export default function SkillAnswerReview({
  value,
  title = '已提交的回答',
  dense = false,
  showEmpty = true,
}) {
  const empty = value == null || value === '';
  if (empty && !showEmpty) return null;
  const lines = summarizeSkillAnswer(value);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: dense ? 1.25 : 2,
        bgcolor: 'grey.50',
        borderRadius: 2,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {!empty && (
          <Chip size="small" label="已记录" color="success" variant="outlined" sx={{ height: 22 }} />
        )}
      </Stack>
      {empty ? (
        <Typography variant="body2" color="text.secondary">（未作答）</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
          {lines.map((line, i) => (
            <Typography
              key={`${i}-${line}`}
              component="li"
              variant="body2"
              sx={{ mb: 0.35, color: 'text.primary' }}
            >
              {line}
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  );
}
