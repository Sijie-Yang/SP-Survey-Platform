import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Stack, Typography } from '@mui/material';
import { emptyMapAnswer, geographicEvaluativeMap, gridCellRing } from '../../lib/mapAnnotation';

/** Knoxville preset from the bundled template. A starting extent, not an administrative boundary. */
const KNOXVILLE = {
  id: 'knoxville-1990',
  revision: 1,
  cityId: 'knoxville',
  center: [-83.9, 35.965],
  boundary: {
    type: 'Polygon',
    coordinates: [[
      [-84.05, 35.88],
      [-83.75, 35.88],
      [-83.75, 36.05],
      [-84.05, 36.05],
      [-84.05, 35.88],
    ]],
  },
};

function closeRing(points) {
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

/** Invented irregular outlines, [longitude, latitude], all inside the Knoxville preset. */
const PLACES = {
  market: { en: 'Market Square', zh: 'Market Square', ring: closeRing([[-83.934, 35.961], [-83.922, 35.955], [-83.908, 35.960], [-83.911, 35.971], [-83.924, 35.976], [-83.936, 35.969]]) },
  oldCity: { en: 'Old City', zh: 'Old City', ring: closeRing([[-83.916, 35.966], [-83.902, 35.962], [-83.894, 35.970], [-83.898, 35.981], [-83.912, 35.984], [-83.920, 35.974]]) },
  campus: { en: 'University of Tennessee', zh: '田纳西大学校园', ring: closeRing([[-83.948, 35.948], [-83.930, 35.942], [-83.916, 35.949], [-83.920, 35.960], [-83.938, 35.963], [-83.951, 35.956]]) },
  sequoyah: { en: 'Sequoyah Hills', zh: 'Sequoyah Hills', ring: closeRing([[-83.978, 35.940], [-83.962, 35.934], [-83.948, 35.941], [-83.952, 35.955], [-83.968, 35.958], [-83.982, 35.948]]) },
  riverbend: { en: 'River bend', zh: '河湾', ring: closeRing([[-83.960, 35.952], [-83.940, 35.944], [-83.920, 35.948], [-83.908, 35.956], [-83.918, 35.962], [-83.942, 35.960], [-83.958, 35.956]]) },
  bearden: { en: 'Bearden', zh: 'Bearden', ring: closeRing([[-84.020, 35.932], [-84.002, 35.924], [-83.988, 35.932], [-83.992, 35.946], [-84.008, 35.950], [-84.024, 35.940]]) },
  fountain: { en: 'Fountain City', zh: 'Fountain City', ring: closeRing([[-83.942, 36.008], [-83.924, 36.002], [-83.912, 36.012], [-83.918, 36.026], [-83.936, 36.028], [-83.948, 36.016]]) },
  island: { en: 'Island Home', zh: 'Island Home', ring: closeRing([[-83.928, 35.922], [-83.910, 35.916], [-83.898, 35.926], [-83.904, 35.940], [-83.922, 35.938], [-83.932, 35.928]]) },
  yard: { en: 'Rail yard', zh: '铁路场地', ring: closeRing([[-83.912, 35.964], [-83.896, 35.958], [-83.886, 35.968], [-83.890, 35.980], [-83.906, 35.978], [-83.916, 35.970]]) },
  strip: { en: 'Commercial strip', zh: '商业带', ring: closeRing([[-83.956, 35.944], [-83.932, 35.938], [-83.910, 35.946], [-83.904, 35.954], [-83.922, 35.958], [-83.946, 35.954], [-83.960, 35.948]]) },
  mall: { en: 'West mall', zh: '西侧商场', ring: closeRing([[-84.018, 35.918], [-84.000, 35.912], [-83.986, 35.922], [-83.992, 35.934], [-84.010, 35.932], [-84.022, 35.924]]) },
};

/** Eight invented participants. Empty disliked lists are an explicit “no area”. */
const SAMPLE = [
  ['demo-1', ['market', 'riverbend'], ['yard']],
  ['demo-2', ['market', 'campus'], ['yard']],
  ['demo-3', ['oldCity', 'market'], ['strip']],
  ['demo-4', ['campus', 'sequoyah'], ['strip']],
  ['demo-5', ['sequoyah', 'riverbend'], []],
  ['demo-6', ['bearden'], ['mall']],
  ['demo-7', ['fountain'], ['yard', 'strip']],
  ['demo-8', ['island', 'oldCity'], []],
];

function areaAnswer(placeIds, label) {
  if (!placeIds.length) return emptyMapAnswer(KNOXVILLE, 'none');
  return {
    ...emptyMapAnswer(KNOXVILLE, 'annotated'),
    features: {
      type: 'FeatureCollection',
      features: placeIds.map((placeId) => ({
        type: 'Feature',
        id: `${label}-${placeId}`,
        geometry: { type: 'Polygon', coordinates: [PLACES[placeId].ring] },
        properties: { label, placeName: PLACES[placeId].en, note: 'demonstration only' },
      })),
    },
  };
}

function demoRows() {
  return SAMPLE.map(([id, liked, disliked]) => ({
    id,
    responses: {
      liked_areas: areaAnswer(liked, 'liked'),
      disliked_areas: areaAnswer(disliked, 'disliked'),
    },
  }));
}

function netColor(net) {
  const clamped = Math.max(-1, Math.min(1, net));
  const red = clamped < 0 ? 180 : Math.round(180 * (1 - clamped));
  const green = clamped > 0 ? 140 : Math.round(140 * (1 + clamped));
  return `rgb(${red},${green},90)`;
}

function pickCells(cells) {
  const byKey = (a, b) => String(a.key).localeCompare(String(b.key));
  const positive = [...cells].filter((cell) => cell.likedCount > cell.dislikedCount).sort((a, b) => b.net - a.net || byKey(a, b))[0];
  const negative = [...cells].filter((cell) => cell.dislikedCount > cell.likedCount).sort((a, b) => a.net - b.net || byKey(a, b))[0];
  const cancel = [...cells].filter((cell) => cell.likedCount > 0 && cell.likedCount === cell.dislikedCount).sort((a, b) => b.likedCount - a.likedCount || byKey(a, b))[0];
  return [
    positive && { ...positive, kind: 'positive' },
    negative && { ...negative, kind: 'negative' },
    cancel && { ...cancel, kind: 'cancel' },
    { key: 'blank', likedCount: 0, dislikedCount: 0, net: 0, kind: 'blank' },
  ].filter(Boolean);
}

function formatNet(liked, disliked, denominator) {
  const net = denominator ? (liked - disliked) / denominator : 0;
  const text = `${net > 0 ? '+' : ''}${net.toFixed(2)}`;
  return text;
}

export default function NasarLikedDemo({ language }) {
  const zh = language === 'zh';
  const holder = useRef(null);
  const mapRef = useRef(null);
  const result = useMemo(() => geographicEvaluativeMap(demoRows(), {
    likedQuestion: 'liked_areas',
    dislikedQuestion: 'disliked_areas',
    studyArea: KNOXVILLE,
    cellMeters: 250,
    mode: 'paired',
  }), []);
  const examples = useMemo(() => pickCells(result.cells || []), [result]);
  const origin = KNOXVILLE.boundary.coordinates[0][0];
  const denominator = result.denominator || SAMPLE.length;

  useEffect(() => {
    if (!holder.current || mapRef.current || !result.ok) return undefined;
    // jsdom has no SVGSVGElement.createSVGRect, so Leaflet's SVG renderer is
    // null and polygon.addTo throws. Skip the map; the written guide still renders.
    if (!L.Browser?.svg && !L.Browser?.vml) return undefined;
    const map = L.map(holder.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    const bounds = [];
    const drawOutline = (placeId, liked) => {
      const ring = PLACES[placeId].ring.map(([lng, lat]) => [lat, lng]);
      bounds.push(...ring);
      L.polygon(ring, {
        color: liked ? '#1b5e20' : '#b71c1c',
        weight: 2,
        fillColor: liked ? '#2e7d32' : '#c62828',
        fillOpacity: 0.05,
        interactive: false,
      }).addTo(map);
    };
    const seen = new Set();
    SAMPLE.forEach(([, liked, disliked]) => {
      liked.forEach((placeId) => {
        const key = `liked:${placeId}`;
        if (seen.has(key)) return;
        seen.add(key);
        drawOutline(placeId, true);
      });
      disliked.forEach((placeId) => {
        const key = `disliked:${placeId}`;
        if (seen.has(key)) return;
        seen.add(key);
        drawOutline(placeId, false);
      });
    });
    result.cells.forEach((cell) => {
      const ring = gridCellRing(origin, cell.ix, cell.iy, result.cellMeters).map(([lng, lat]) => [lat, lng]);
      bounds.push(...ring);
      const fill = netColor(cell.net);
      L.polygon(ring, {
        color: fill,
        weight: 1,
        fillColor: fill,
        fillOpacity: 0.55,
        interactive: false,
      }).addTo(map);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [16, 16] });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [result, origin]);

  const placeLine = (ids) => {
    if (!ids.length) return zh ? '没有区域' : 'no area';
    return ids.map((id) => (zh ? PLACES[id].zh : PLACES[id].en)).join(zh ? '、' : ', ');
  };
  const caption = {
    positive: zh ? '喜欢的人更多，格子偏绿。' : 'More people liked it, so the cell is green.',
    negative: zh ? '不喜欢的人更多，格子偏红。' : 'More people disliked it, so the cell is red.',
    cancel: zh ? '两边人数相同，净值是 0，但格子上仍有标注。' : 'The two counts match, so the net is 0, but the cell was still marked.',
    blank: zh ? '没有人的多边形盖住这里，地图上留白。' : 'No polygon covers this cell, so the map leaves it blank.',
  };

  return (
    <Stack gap={1.5} sx={{ mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={700}>{zh ? '净评价示意 · Knoxville' : 'Net map · Knoxville demonstration'}</Typography>
      <Typography variant="body2">
        {zh
          ? `下面 8 名参与者和画出的多边形都是为这篇指南编的，不是 Nasar 的受访者，也不是收集到的研究结果。每人最多标出几块不规则区域；不喜欢题可以明确选“没有区域”。格子是 250 米。同一个人的重叠区域在同一层只计一次。净值 =（喜欢人数 − 不喜欢人数）/ ${denominator}。绿线是喜欢的多边形，红线是不喜欢的多边形。`
          : `These 8 participants and the polygons they draw are invented for this guide. They are not Nasar’s respondents and not collected results. Each person marks a few irregular areas. A disliked question can be an explicit “no area”. Cells are 250 m. Overlapping areas from one person count once on that layer. Net = (people who liked it − people who disliked it) / ${denominator}. Green outlines are liked polygons. Red outlines are disliked polygons.`}
      </Typography>
      <Box ref={holder} role="img" aria-label={zh ? '演示用的 Knoxville 不规则标注和净评价网格' : 'Demonstration irregular marks and net grid for Knoxville'} sx={{ height: 420, borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider', '& .leaflet-container': { height: '100%', width: '100%', background: '#e8eef2' } }} />
      <Typography variant="caption" color="text.secondary">
        {zh ? `两题都完成的人数 N = ${denominator}。未覆盖的范围留白，不逐格列坐标。下面四格取自这张图，用来对照颜色。` : `People who finished both questions: N = ${denominator}. Uncovered ground stays blank. Cell coordinates are not listed. The four cells below are taken from this map so the colors can be read.`}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
        {examples.map((cell) => (
          <Box key={cell.kind} sx={{ flex: 1, p: 2, bgcolor: cell.kind === 'blank' ? 'background.paper' : 'action.selected', border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="h5">{formatNet(cell.likedCount, cell.dislikedCount, denominator)}</Typography>
            <Typography variant="body2">{zh ? `${cell.likedCount} 人喜欢 · ${cell.dislikedCount} 人不喜欢` : `${cell.likedCount} liked · ${cell.dislikedCount} disliked`}</Typography>
            <Typography variant="caption" component="p">{zh ? `（${cell.likedCount} − ${cell.dislikedCount}）/ ${denominator}` : `(${cell.likedCount} − ${cell.dislikedCount}) / ${denominator}`}</Typography>
            <Typography variant="caption">{caption[cell.kind]}</Typography>
          </Box>
        ))}
      </Stack>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {SAMPLE.map(([id, liked, disliked]) => (
          <Typography component="li" variant="caption" color="text.secondary" key={id}>
            {id}: {zh ? `喜欢 ${placeLine(liked)}；不喜欢 ${placeLine(disliked)}` : `liked ${placeLine(liked)}; disliked ${placeLine(disliked)}`}
          </Typography>
        ))}
      </Box>
    </Stack>
  );
}
