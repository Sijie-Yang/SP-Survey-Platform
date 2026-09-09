import React, { lazy, Suspense } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography, useMediaQuery, useTheme } from '@mui/material';

const ResultsAnalysis = lazy(() => import('./ResultsAnalysis'));

export default function AdminProjectResultsDialog({ project, onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  if (!project) return null;
  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="xl" aria-labelledby="admin-project-results-title">
      <DialogTitle id="admin-project-results-title" sx={{ overflowWrap: 'anywhere' }}>
        结果分析 · {project.name || '未命名项目'}
        <Typography component="span" display="block" variant="caption" color="text.secondary">{project.id}</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 1, sm: 3 } }}>
        <Suspense fallback={<Box role="status" sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={28} /><Typography>正在加载结果分析…</Typography></Box>}>
          <ResultsAnalysis key={project.id} currentProject={project} surveyConfig={project.config || {}} adminMode />
        </Suspense>
      </DialogContent>
      <DialogActions><Button onClick={onClose} sx={{ minHeight: 44 }}>返回项目概览</Button></DialogActions>
    </Dialog>
  );
}
