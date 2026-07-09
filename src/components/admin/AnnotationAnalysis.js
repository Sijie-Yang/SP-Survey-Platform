import React, { useMemo, useContext } from 'react';
import { Box, Typography, Button, Stack, Chip } from '@mui/material';
import { AnnotationOverlay } from '../ImageAnnotationWidget';
import { ImageResolverContext } from './imageResolverContext';

/**
 * Group annotation answers by base image URL and render overlay + export.
 */
export default function AnnotationAnalysis({ answers, questionName, responses }) {
  const nameToUrl = useContext(ImageResolverContext);

  const byImage = useMemo(() => {
    const isUrl = (s) => s && (s.startsWith('http') || s.startsWith('/') || s.startsWith('data:'));
    const map = {};
    answers.forEach(({ answer, shown_images }, idx) => {
      const ann = typeof answer === 'object' ? answer : null;
      if (!ann?.shapes?.length) return;
      let imgUrl = ann.image || shown_images?.[0] || 'unknown';
      // Responses may store a bare filename — resolve it via project media
      if (!isUrl(imgUrl) && nameToUrl?.has(imgUrl)) imgUrl = nameToUrl.get(imgUrl);
      if (!map[imgUrl]) map[imgUrl] = [];
      map[imgUrl].push({ shapes: ann.shapes, participantIndex: idx });
    });
    return map;
  }, [answers, nameToUrl]);

  const exportAnnotationCsv = () => {
    const rows = [['participant_id', 'session_id', 'attempt_index', 'question', 'image', 'tool', 'points_json']];
    (responses || []).forEach((row) => {
      const qData = row.responses?.[questionName];
      const ann = qData?.answer || qData;
      if (!ann?.shapes) return;
      const img = ann.image || '';
      ann.shapes.forEach((shape) => {
        rows.push([
          row.participant_id || '',
          row.survey_metadata?.session_id || '',
          row.survey_metadata?.attempt_index ?? '',
          questionName,
          img.split('/').pop(),
          shape.tool,
          JSON.stringify(shape.points),
        ]);
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${questionName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAnnotationJson = () => {
    const payload = (responses || []).map((row) => ({
      participant_id: row.participant_id,
      session_id: row.survey_metadata?.session_id,
      attempt_index: row.survey_metadata?.attempt_index,
      annotation: row.responses?.[questionName]?.answer || row.responses?.[questionName],
    })).filter((r) => r.annotation?.shapes?.length);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${questionName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const imageKeys = Object.keys(byImage);
  if (!imageKeys.length) {
    return <Typography variant="body2" color="text.secondary">No annotation data yet.</Typography>;
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button size="small" variant="outlined" onClick={exportAnnotationCsv}>Export CSV</Button>
        <Button size="small" variant="outlined" onClick={exportAnnotationJson}>Export JSON</Button>
      </Stack>
      {imageKeys.map((imgUrl) => (
        <Box key={imgUrl} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {imgUrl.split('/').pop()}
            <Chip size="small" label={`${byImage[imgUrl].length} participant(s)`} sx={{ ml: 1 }} />
          </Typography>
          <AnnotationOverlay
            imageUrl={imgUrl}
            annotations={byImage[imgUrl]}
            width={480}
          />
        </Box>
      ))}
    </Box>
  );
}
