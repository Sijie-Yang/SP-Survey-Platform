import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Button, ButtonGroup, Typography } from '@mui/material';

const TOOL_COLORS = { point: '#e53935', line: '#1e88e5', region: '#43a047' };

function normalizePoint(x, y, w, h) {
  return { x: x / w, y: y / h };
}

function denormalizePoint(p, w, h) {
  return { x: p.x * w, y: p.y * h };
}

export default function ImageAnnotationCanvas({
  imageUrl,
  value,
  onChange,
  allowedTools = ['point', 'line', 'region'],
  readOnly = false,
  minAnnotations = 0,
  maxAnnotations = 50,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [tool, setTool] = useState(allowedTools[0] || 'point');
  const [drawing, setDrawing] = useState([]);
  const [shapes, setShapes] = useState(value?.shapes || []);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [imgError, setImgError] = useState(false);
  const [imgSrc, setImgSrc] = useState(imageUrl);

  useEffect(() => {
    setShapes(value?.shapes || []);
  }, [value]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete) return;
    const ctx = canvas.getContext('2d');
    const w = img.clientWidth;
    const h = img.clientHeight;
    canvas.width = w;
    canvas.height = h;
    setDims({ w, h });
    ctx.clearRect(0, 0, w, h);

    const drawShape = (shape, alpha = 1) => {
      const pts = shape.points.map((p) => denormalizePoint(p, w, h));
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = TOOL_COLORS[shape.tool] || '#333';
      ctx.fillStyle = TOOL_COLORS[shape.tool] || '#333';
      ctx.lineWidth = 2;
      if (shape.tool === 'point' && pts[0]) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape.tool === 'line' && pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); });
      } else if (shape.tool === 'region' && pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        if (pts.length >= 3) ctx.closePath();
        ctx.fillStyle = (TOOL_COLORS.region || '#43a047') + '55';
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    shapes.forEach((s) => drawShape(s));
    if (drawing.length) {
      drawShape({ tool, points: drawing }, 0.7);
    }
  }, [shapes, drawing, tool]);

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [redraw, imageUrl]);

  useEffect(() => {
    setImgSrc(imageUrl);
    setImgError(false);
  }, [imageUrl]);

  const commitShape = (pts) => {
    if (!pts.length) return;
    if (maxAnnotations > 0 && shapes.length >= maxAnnotations) return;
    const next = [...shapes, { tool, points: pts }];
    setShapes(next);
    setDrawing([]);
    onChange?.({ image: imageUrl, shapes: next });
  };

  const handleClick = (e) => {
    if (readOnly || !dims.w || imgError) return;
    if (maxAnnotations > 0 && shapes.length >= maxAnnotations) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pt = normalizePoint(x, y, dims.w, dims.h);

    if (tool === 'point') {
      commitShape([pt]);
    } else if (tool === 'line') {
      const next = [...drawing, pt];
      setDrawing(next);
      if (next.length >= 2) commitShape(next);
    } else if (tool === 'region') {
      const next = [...drawing, pt];
      setDrawing(next);
    }
  };

  const handleDblClick = () => {
    if (readOnly || tool !== 'region' || drawing.length < 3) return;
    commitShape(drawing);
  };

  const undo = () => {
    const next = shapes.slice(0, -1);
    setShapes(next);
    onChange?.({ image: imageUrl, shapes: next });
  };

  const clear = () => {
    setShapes([]);
    setDrawing([]);
    onChange?.({ image: imageUrl, shapes: [] });
  };

  return (
    <Box ref={containerRef}>
      {!readOnly && (
        <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <ButtonGroup size="small">
            {allowedTools.includes('point') && (
              <Button variant={tool === 'point' ? 'contained' : 'outlined'} onClick={() => { setTool('point'); setDrawing([]); }}>Point</Button>
            )}
            {allowedTools.includes('line') && (
              <Button variant={tool === 'line' ? 'contained' : 'outlined'} onClick={() => { setTool('line'); setDrawing([]); }}>Line</Button>
            )}
            {allowedTools.includes('region') && (
              <Button variant={tool === 'region' ? 'contained' : 'outlined'} onClick={() => { setTool('region'); setDrawing([]); }}>Region</Button>
            )}
          </ButtonGroup>
          <Button size="small" onClick={undo} disabled={!shapes.length}>Undo</Button>
          <Button size="small" color="error" onClick={clear} disabled={!shapes.length}>Clear</Button>
          {(minAnnotations > 0 || maxAnnotations < 50) && (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Annotations: {shapes.length}{maxAnnotations < 50 ? ` / ${maxAnnotations}` : ''}{minAnnotations > 0 ? ` (min ${minAnnotations})` : ''}
            </Typography>
          )}
          {tool === 'region' && (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Double-click to close polygon
            </Typography>
          )}
        </Box>
      )}
      <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
        {imgError ? (
          <Box sx={{ p: 3, bgcolor: 'grey.100', borderRadius: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Image failed to load</Typography>
            <Button size="small" onClick={() => { setImgError(false); setImgSrc(`${imageUrl}${imageUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`); }}>Retry</Button>
          </Box>
        ) : (
        <img
          ref={imgRef}
          src={imgSrc}
          alt="annotate"
          style={{ maxWidth: '100%', display: 'block', borderRadius: 8 }}
          onLoad={redraw}
          onError={() => setImgError(true)}
        />
        )}
        {!imgError && (
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onDoubleClick={handleDblClick}
          style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            cursor: readOnly ? 'default' : 'crosshair',
          }}
        />
        )}
      </Box>
    </Box>
  );
}

/** Overlay multiple participants' annotations on one image (for ResultsAnalysis). */
export function AnnotationOverlay({ imageUrl, annotations, width = 500 }) {
  const canvasRef = useRef(null);
  const PARTICIPANT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    let cancelled = false;

    const drawAnnotations = (ctx, w, h) => {
      annotations.forEach((ann, pi) => {
        const color = PARTICIPANT_COLORS[pi % PARTICIPANT_COLORS.length];
        (ann.shapes || []).forEach((shape) => {
          const pts = shape.points.map((p) => ({ x: p.x * w, y: p.y * h }));
          ctx.globalAlpha = 0.65;
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 2;
          if (shape.tool === 'point' && pts[0]) {
            ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 5, 0, Math.PI * 2); ctx.fill();
          } else if (shape.tool === 'line' && pts.length >= 2) {
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke();
          } else if (shape.tool === 'region' && pts.length >= 3) {
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath();
            ctx.fillStyle = color + '44'; ctx.fill(); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        });
      });
    };

    const render = (img) => {
      if (cancelled) return;
      const aspect = img ? img.height / img.width : 0.625;
      const w = width;
      const h = Math.round(w * aspect);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (img) {
        ctx.drawImage(img, 0, 0, w, h);
      } else {
        // Image unavailable — grey placeholder so annotations remain visible
        ctx.fillStyle = '#eceff1';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#90a4ae';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Image unavailable — showing annotations only', w / 2, h / 2);
        ctx.textAlign = 'start';
      }
      drawAnnotations(ctx, w, h);
    };

    // Try with CORS first (keeps canvas exportable); if the host doesn't send
    // CORS headers the load fails, so retry without crossOrigin (canvas becomes
    // tainted but still displays). Last resort: placeholder background.
    const tryLoad = (useCors) => {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = () => render(img);
      img.onerror = () => {
        if (cancelled) return;
        if (useCors) tryLoad(false);
        else render(null);
      };
      img.src = imageUrl;
    };
    tryLoad(true);

    return () => { cancelled = true; };
  }, [imageUrl, annotations, width]);

  return <canvas ref={canvasRef} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }} />;
}
