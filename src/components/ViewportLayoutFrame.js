import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { applyContentWidthToModel, resolvePublishedFrame } from '../lib/viewportLayout';

/**
 * Applies the saved desktop/mobile content width and media cap.
 * Preview passes forcedViewport plus the slider values. The participant
 * survey passes the published config and follows the window width.
 */
export default function ViewportLayoutFrame({
  config = null,
  forcedViewport = null,
  contentWidth = null,
  questionWidth = null,
  mediaMaxHeight = null,
  surveyModel = null,
  children,
}) {
  const [windowWidth, setWindowWidth] = useState(() => (
    typeof window === 'undefined' ? 1280 : window.innerWidth
  ));

  useEffect(() => {
    if (forcedViewport) return undefined;
    const onResize = () => setWindowWidth(window.innerWidth || 1280);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [forcedViewport]);

  const published = forcedViewport ? null : resolvePublishedFrame(config, windowWidth);
  const viewport = forcedViewport || published?.viewport || 'desktop';
  const resolvedContentWidth = contentWidth > 0 ? contentWidth : (published?.contentWidth || null);
  const resolvedQuestionWidth = questionWidth > 0 ? questionWidth : (published?.questionWidth || null);
  const resolvedMedia = mediaMaxHeight > 0 ? mediaMaxHeight : (published?.mediaMaxHeight || null);
  const viewportWidth = forcedViewport === 'mobile' ? 390 : forcedViewport === 'desktop' ? 1280 : windowWidth;

  useEffect(() => {
    applyContentWidthToModel(surveyModel, resolvedContentWidth);
  }, [surveyModel, resolvedContentWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('resize'));
  }, [resolvedMedia, viewportWidth, resolvedContentWidth, resolvedQuestionWidth]);

  return (
    <Box
      data-sp-viewport-layout=""
      data-sp-viewport={viewport}
      data-sp-viewport-width={String(viewportWidth)}
      {...(resolvedContentWidth ? { 'data-sp-content-width': String(resolvedContentWidth) } : {})}
      {...(resolvedQuestionWidth ? { 'data-sp-question-width': String(resolvedQuestionWidth) } : {})}
      {...(resolvedMedia ? { 'data-sp-media-max-height': String(resolvedMedia) } : {})}
      sx={{
        width: forcedViewport === 'mobile' ? 390 : '100%',
        maxWidth: forcedViewport === 'mobile' ? 390 : '100%',
        mx: 'auto',
        boxSizing: 'border-box',
        ...(forcedViewport === 'mobile' ? {
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'auto',
          bgcolor: 'background.paper',
        } : {}),
        ...(resolvedMedia ? { '--sp-media-max-height': `${resolvedMedia}px` } : {}),
        ...(resolvedQuestionWidth ? { '--sp-question-width': `${resolvedQuestionWidth}px` } : {}),
        ...(resolvedQuestionWidth ? {
          '& .sd-element--with-frame': {
            width: 'var(--sp-question-width)',
            maxWidth: '100%',
            flex: '0 0 auto',
            marginLeft: 'auto',
            marginRight: 'auto',
          },
        } : {}),
      }}
    >
      <Box data-sp-content-column="" sx={{ width: '100%', maxWidth: resolvedContentWidth || 'none', mx: 'auto' }}>
        {children}
      </Box>
    </Box>
  );
}
