import React, { useState, useEffect, useMemo, useCallback, createContext, useContext } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  Button,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Tooltip,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  TextField,
  InputAdornment
} from '@mui/material';
import {
  Refresh,
  Download,
  Assessment,
  People,
  ExpandMore,
  ExpandLess,
  Storage,
  Cloud,
  Search,
  QuestionAnswer,
  Image as ImageIcon,
  TextFields,
  Star,
  CheckBox,
  RadioButtonChecked,
  LinearScale,
  TableChart
} from '@mui/icons-material';
import { createClient } from '@supabase/supabase-js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RATING_COLORS = ['#f44336', '#ff9800', '#ffc107', '#8bc34a', '#4caf50'];
const BAR_COLORS = [
  '#1976d2', '#2196f3', '#0288d1', '#0097a7', '#00838f',
  '#388e3c', '#689f38', '#f57c00', '#e64a19', '#7b1fa2'
];

function pct(count, total) {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

function average(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Collect answers for a question from all responses.
// Handles two formats:
//   New: responses[name] = { type, answer, shown_images }
//   Old: responses[name] = <raw_answer>, displayed_images[name] = [...]
function collectAnswers(questionName, responses) {
  const result = [];
  for (const row of responses) {
    const qData = row.responses?.[questionName];
    if (qData === undefined || qData === null) continue;

    let ans, shown;

    if (qData !== null && typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
      // New enriched format: { type, answer, shown_images }
      ans = qData.answer;
      shown = qData.shown_images?.length
        ? qData.shown_images
        : (row.displayed_images?.[questionName] || []);
    } else {
      // Old raw format: the value IS the answer
      ans = qData;
      shown = row.displayed_images?.[questionName] || [];
    }

    if (ans === null || ans === undefined || ans === '') continue;
    result.push({ answer: ans, shown_images: shown });
  }
  return result;
}

// Frequency map: { choice: count }
function frequencyMap(answers, getValue) {
  const freq = {};
  for (const { answer } of answers) {
    const vals = Array.isArray(answer) ? answer : [answer];
    for (const v of vals) {
      const key = getValue ? getValue(v) : String(v);
      freq[key] = (freq[key] || 0) + 1;
    }
  }
  return freq;
}

function typeIcon(type) {
  const icons = {
    rating: <Star fontSize="small" />,
    text: <TextFields fontSize="small" />,
    comment: <TextFields fontSize="small" />,
    radiogroup: <RadioButtonChecked fontSize="small" />,
    checkbox: <CheckBox fontSize="small" />,
    dropdown: <RadioButtonChecked fontSize="small" />,
    boolean: <CheckBox fontSize="small" />,
    matrix: <TableChart fontSize="small" />,
    image_rating: <ImageIcon fontSize="small" />,
    image_ranking: <ImageIcon fontSize="small" />,
    image_boolean: <ImageIcon fontSize="small" />,
    image_matrix: <ImageIcon fontSize="small" />,
    slider: <LinearScale fontSize="small" />,
  };
  return icons[type] || <QuestionAnswer fontSize="small" />;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HorizontalBar({ label, count, total, color, index }) {
  const width = pct(count, total);
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography variant="body2" sx={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {count} ({width}%)
        </Typography>
      </Box>
      <Box sx={{ height: 14, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
        <Box
          sx={{
            height: '100%',
            width: `${width}%`,
            bgcolor: color || BAR_COLORS[index % BAR_COLORS.length],
            borderRadius: 1,
            transition: 'width 0.6s ease'
          }}
        />
      </Box>
    </Box>
  );
}

function RatingDistribution({ answers, rateMin = 1, rateMax = 5 }) {
  const nums = answers.map(a => Number(a.answer)).filter(n => !isNaN(n));
  const avg = average(nums);
  const freq = {};
  for (let i = rateMin; i <= rateMax; i++) freq[i] = 0;
  nums.forEach(n => { if (freq[n] !== undefined) freq[n]++; });
  const colorStops = RATING_COLORS.slice(0, rateMax - rateMin + 1);

  return (
    <Box>
      {avg !== null && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            {avg.toFixed(2)}
          </Typography>
          <Typography variant="body2" color="text.secondary">/ {rateMax} average</Typography>
        </Box>
      )}
      {Object.entries(freq).map(([score, count], idx) => (
        <HorizontalBar
          key={score}
          label={`${score} star${Number(score) !== 1 ? 's' : ''}`}
          count={count}
          total={nums.length}
          color={colorStops[idx]}
        />
      ))}
    </Box>
  );
}

function ChoiceDistribution({ answers, choices }) {
  const freq = frequencyMap(answers);
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;
  const total = answers.length;

  // Map values to labels if choices provided
  const labelMap = {};
  if (choices) {
    for (const c of choices) {
      const val = typeof c === 'object' ? c.value : c;
      const text = typeof c === 'object' ? (c.text || c.value) : c;
      labelMap[String(val)] = String(text);
    }
  }

  return (
    <Box>
      {sorted.map(([value, count], idx) => (
        <HorizontalBar
          key={value}
          label={labelMap[value] || value}
          count={count}
          total={total}
          index={idx}
        />
      ))}
      {sorted.length === 0 && (
        <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
      )}
    </Box>
  );
}

function TextAnswers({ answers, maxVisible = 5 }) {
  const [showAll, setShowAll] = useState(false);
  const texts = answers.map(a => String(a.answer)).filter(Boolean);
  const visible = showAll ? texts : texts.slice(0, maxVisible);

  return (
    <Box>
      {visible.map((text, idx) => (
        <Paper
          key={idx}
          variant="outlined"
          sx={{ p: 1.5, mb: 1, bgcolor: 'grey.50', borderRadius: 1 }}
        >
          <Typography variant="body2">{text}</Typography>
        </Paper>
      ))}
      {texts.length === 0 && (
        <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
      )}
      {texts.length > maxVisible && (
        <Button size="small" onClick={() => setShowAll(v => !v)} sx={{ mt: 0.5 }}>
          {showAll ? `Show less` : `Show all ${texts.length} responses`}
        </Button>
      )}
    </Box>
  );
}

function BooleanDistribution({ answers }) {
  const trueCount = answers.filter(a => a.answer === true || a.answer === 'true').length;
  const falseCount = answers.filter(a => a.answer === false || a.answer === 'false').length;
  const total = trueCount + falseCount;

  return (
    <Box>
      <HorizontalBar label="Yes / True" count={trueCount} total={total} color="#4caf50" />
      <HorizontalBar label="No / False" count={falseCount} total={total} color="#f44336" />
    </Box>
  );
}

function MatrixDistribution({ answers, rows, columns }) {
  // Aggregate per row
  const rowData = {};
  for (const { answer } of answers) {
    if (typeof answer !== 'object' || !answer) continue;
    for (const [row, val] of Object.entries(answer)) {
      if (!rowData[row]) rowData[row] = {};
      const key = String(val);
      rowData[row][key] = (rowData[row][key] || 0) + 1;
    }
  }

  const rowKeys = rows ? rows.map(r => (typeof r === 'object' ? r.value : r)) : Object.keys(rowData);
  const colKeys = columns ? columns.map(c => (typeof c === 'object' ? c.value : c)) : [];

  // Infer columns if not provided
  if (!colKeys.length) {
    const seen = new Set();
    for (const row of Object.values(rowData)) {
      Object.keys(row).forEach(k => seen.add(k));
    }
    colKeys.push(...seen);
  }

  if (!rowKeys.length) return <Typography variant="body2" color="text.secondary">No data.</Typography>;

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: '100%', overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 'bold' }}>Question Row</TableCell>
            {colKeys.map(col => (
              <TableCell key={col} align="center" sx={{ fontWeight: 'bold' }}>{col}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rowKeys.map(row => {
            const rowLabel = rows
              ? (rows.find(r => (typeof r === 'object' ? r.value : r) === row) || row)
              : row;
            const label = typeof rowLabel === 'object' ? (rowLabel.text || rowLabel.value) : rowLabel;
            const total = Object.values(rowData[row] || {}).reduce((a, b) => a + b, 0);
            return (
              <TableRow key={row}>
                <TableCell>{label}</TableCell>
                {colKeys.map(col => {
                  const count = rowData[row]?.[col] || 0;
                  return (
                    <TableCell key={col} align="center">
                      <Typography variant="body2">{count}</Typography>
                      {total > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {pct(count, total)}%
                        </Typography>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// Context: carries a resolver function (filename | url) → displayable URL
// value is a Map<name, url> built from currentProject.preloadedImages
const ImageResolverContext = createContext(null);

// Detect whether a string is a usable URL
function isUrl(str) {
  return str && (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('/'));
}

// Extract a short display name from a URL or filename
function shortName(str) {
  if (!str) return '(unknown)';
  const base = str.split('?')[0].split('/').pop();
  return base || str;
}

// Resolve a value (URL or filename) to a displayable image URL
function useResolvedUrl(value) {
  const nameToUrl = useContext(ImageResolverContext);
  if (!value) return null;
  if (isUrl(value)) return value;
  // Look up from preloadedImages name→url map
  if (nameToUrl && nameToUrl.has(value)) return nameToUrl.get(value);
  return null; // can't resolve → show as text chip
}

// Single image item — thumbnail if resolvable, name chip otherwise
function ImageItem({ value, badge }) {
  const resolvedUrl = useResolvedUrl(value);
  const [hover, setHover] = useState(false);
  const [imgError, setImgError] = useState(false);
  const name = shortName(value);

  if (resolvedUrl && !imgError) {
    return (
      <Box sx={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        <Box
          component="img"
          src={resolvedUrl}
          alt={name}
          onError={() => setImgError(true)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          sx={{
            width: 100, height: 100, objectFit: 'cover', borderRadius: 1.5,
            border: '2px solid', borderColor: hover ? 'primary.main' : 'divider',
            cursor: 'zoom-in', transition: 'all 0.2s',
            boxShadow: hover ? 3 : 1,
            transform: hover ? 'scale(1.05)' : 'scale(1)',
          }}
        />
        {badge !== undefined && (
          <Chip label={badge} size="small" color="primary" sx={{ fontSize: '0.7rem', height: 20 }} />
        )}
        <Typography variant="caption" color="text.secondary" sx={{
          maxWidth: 100, textOverflow: 'ellipsis', overflow: 'hidden',
          whiteSpace: 'nowrap', fontSize: '0.65rem', textAlign: 'center'
        }}>
          {name}
        </Typography>
      </Box>
    );
  }

  // Fallback: display as labelled name chip (when URL can't be resolved or image fails)
  return (
    <Chip
      icon={<ImageIcon fontSize="small" />}
      label={badge !== undefined ? `${badge} ${name}` : name}
      size="small"
      variant="outlined"
      color="primary"
      sx={{ maxWidth: 220, fontSize: '0.72rem' }}
    />
  );
}

// Image group header — shows all images in a set, with an optional title
function ShownImagesContext({ imageUrls, label }) {
  if (!imageUrls || imageUrls.length === 0) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {label || 'Image(s) shown:'}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
        {imageUrls.map((v, i) => (
          <ImageItem key={v + i} value={v} index={i} />
        ))}
      </Box>
    </Box>
  );
}

function ImageQuestionAnalysis({ answers, type, question }) {
  // ── image_ranking ─────────────────────────────────────────────────────────
  // answer = [url_rank1, url_rank2, ...] (already URL-mapped by SurveyApp)
  // shown_images = same set of URLs that were available to rank
  if (type === 'image_ranking' || type === 'imageranking') {
    // Per-image: collect every rank position it received
    const imageRankPositions = {}; // { url: [rank0, rank1, ...] }
    for (const { answer } of answers) {
      const ranked = Array.isArray(answer) ? answer : [];
      ranked.forEach((url, rankIdx) => {
        if (!imageRankPositions[url]) imageRankPositions[url] = [];
        imageRankPositions[url].push(rankIdx + 1); // 1-based rank
      });
    }

    // Sort by average rank (ascending = better)
    const sorted = Object.entries(imageRankPositions)
      .map(([url, ranks]) => ({ url, avg: average(ranks), count: ranks.length }))
      .sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));

    const maxRank = sorted.length;

    return (
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Average rank position across all responses (rank 1 = most preferred)
        </Typography>
        {sorted.map(({ url, avg, count }, idx) => (
          <Box key={url} sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <ImageItem value={url} badge={`#${idx + 1}`} index={idx} />
            <Box sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                  Avg rank: <strong>{avg?.toFixed(2) ?? '–'}</strong> / {maxRank}
                </Typography>
                <Typography variant="caption" color="text.secondary">n={count}</Typography>
              </Box>
              <Box sx={{ height: 12, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
                <Box
                  sx={{
                    height: '100%',
                    width: `${pct(maxRank - (avg ?? maxRank) + 1, maxRank)}%`,
                    bgcolor: BAR_COLORS[idx % BAR_COLORS.length],
                    borderRadius: 1,
                    transition: 'width 0.6s ease'
                  }}
                />
              </Box>
            </Box>
          </Box>
        ))}
        {sorted.length === 0 && (
          <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
        )}
      </Box>
    );
  }

  // ── image_rating ──────────────────────────────────────────────────────────
  // answer = a single number (overall rating for the shown image set)
  // shown_images = the image(s) that were shown
  if (type === 'image_rating' || type === 'imagerating') {
    // Group responses by shown_images key so we can show each image's stats
    const imageSetMap = {}; // { setKey: { urls, ratings[] } }
    for (const { answer, shown_images } of answers) {
      const rating = Number(answer);
      if (isNaN(rating) || !shown_images?.length) continue;
      const key = JSON.stringify([...shown_images].sort());
      if (!imageSetMap[key]) imageSetMap[key] = { urls: shown_images, ratings: [] };
      imageSetMap[key].ratings.push(rating);
    }

    const rateMax = question.rateMax ?? 5;
    const rateMin = question.rateMin ?? 1;
    const entries = Object.values(imageSetMap);

    return (
      <Box>
        {entries.map(({ urls, ratings }, idx) => {
          const avg = average(ratings);
          const freq = {};
          for (let i = rateMin; i <= rateMax; i++) freq[i] = 0;
          ratings.forEach(r => { if (freq[r] !== undefined) freq[r]++; });
          return (
            <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
              <ShownImagesContext imageUrls={urls} label={urls.length > 1 ? 'Image set shown:' : 'Image shown:'} />
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
                <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  {avg?.toFixed(2) ?? '–'}
                </Typography>
                <Typography variant="body2" color="text.secondary">/ {rateMax} avg · n={ratings.length}</Typography>
              </Box>
              {Object.entries(freq).map(([score, count], i) => (
                <HorizontalBar
                  key={score}
                  label={`${score} star${Number(score) !== 1 ? 's' : ''}`}
                  count={count}
                  total={ratings.length}
                  color={RATING_COLORS[Math.min(i, RATING_COLORS.length - 1)]}
                />
              ))}
            </Paper>
          );
        })}
        {entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
        )}
      </Box>
    );
  }

  // ── image_boolean ─────────────────────────────────────────────────────────
  // answer = true | false  ·  shown_images = the image(s) shown
  if (type === 'image_boolean' || type === 'imageboolean') {
    const imageSetMap = {}; // { setKey: { urls, yes, no } }
    for (const { answer, shown_images } of answers) {
      if (!shown_images?.length) continue;
      const key = JSON.stringify([...shown_images].sort());
      if (!imageSetMap[key]) imageSetMap[key] = { urls: shown_images, yes: 0, no: 0 };
      if (answer === true || answer === 'true') imageSetMap[key].yes++;
      else imageSetMap[key].no++;
    }
    const entries = Object.values(imageSetMap);
    return (
      <Box>
        {entries.map(({ urls, yes, no }, idx) => {
          const total = yes + no;
          return (
            <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
              <ShownImagesContext imageUrls={urls} label={urls.length > 1 ? 'Image set shown:' : 'Image shown:'} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                n={total}
              </Typography>
              <HorizontalBar label="Yes / True" count={yes} total={total} color="#4caf50" />
              <HorizontalBar label="No / False" count={no} total={total} color="#f44336" />
            </Paper>
          );
        })}
        {entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
        )}
      </Box>
    );
  }

  // ── image_matrix ──────────────────────────────────────────────────────────
  // answer = { row_value: col_value }  ·  shown_images = images shown as context
  if (type === 'image_matrix' || type === 'imagematrix') {
    const imageSetMap = {}; // { setKey: { urls, rowData: { row: { col: count } } } }
    for (const { answer, shown_images } of answers) {
      if (typeof answer !== 'object' || !answer) continue;
      const key = JSON.stringify([...(shown_images || [])].sort());
      if (!imageSetMap[key]) imageSetMap[key] = { urls: shown_images || [], rowData: {} };
      for (const [row, val] of Object.entries(answer)) {
        if (!imageSetMap[key].rowData[row]) imageSetMap[key].rowData[row] = {};
        const colKey = String(val);
        imageSetMap[key].rowData[row][colKey] = (imageSetMap[key].rowData[row][colKey] || 0) + 1;
      }
    }

    const rowDefs = question.rows || [];
    const colDefs = question.columns || [];

    const entries = Object.values(imageSetMap);
    return (
      <Box>
        {entries.map(({ urls, rowData }, idx) => {
          const rowKeys = rowDefs.length
            ? rowDefs.map(r => (typeof r === 'object' ? r.value : r))
            : Object.keys(rowData);
          const colKeys = colDefs.length
            ? colDefs.map(c => (typeof c === 'object' ? c.value : c))
            : [...new Set(Object.values(rowData).flatMap(r => Object.keys(r)))];

          return (
            <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
              <ShownImagesContext imageUrls={urls} />
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 'bold', minWidth: 120 }}>Attribute</TableCell>
                      {colKeys.map(col => {
                        const colDef = colDefs.find(c => (typeof c === 'object' ? c.value : c) === col);
                        const colLabel = colDef ? (typeof colDef === 'object' ? (colDef.text || colDef.value) : colDef) : col;
                        return (
                          <TableCell key={col} align="center" sx={{ fontWeight: 'bold', minWidth: 80 }}>
                            {colLabel}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rowKeys.map(row => {
                      const rowDef = rowDefs.find(r => (typeof r === 'object' ? r.value : r) === row);
                      const rowLabel = rowDef ? (typeof rowDef === 'object' ? (rowDef.text || rowDef.value) : rowDef) : row;
                      const rowTotal = Object.values(rowData[row] || {}).reduce((s, v) => s + v, 0);
                      return (
                        <TableRow key={row}>
                          <TableCell sx={{ fontWeight: 500 }}>{rowLabel}</TableCell>
                          {colKeys.map(col => {
                            const count = rowData[row]?.[col] || 0;
                            const w = rowTotal > 0 ? pct(count, rowTotal) : 0;
                            return (
                              <TableCell key={col} align="center">
                                <Typography variant="body2">{count}</Typography>
                                {rowTotal > 0 && (
                                  <Box sx={{ height: 4, bgcolor: 'grey.100', borderRadius: 1, mt: 0.3 }}>
                                    <Box sx={{ height: '100%', width: `${w}%`, bgcolor: 'primary.main', borderRadius: 1 }} />
                                  </Box>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          );
        })}
        {entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">No responses yet.</Typography>
        )}
      </Box>
    );
  }

  // ── fallback ──────────────────────────────────────────────────────────────
  const allShownImages = [...new Set(answers.flatMap(a => a.shown_images || []))];
  return (
    <Box>
      <ShownImagesContext imageUrls={allShownImages} />
      <ChoiceDistribution answers={answers} />
    </Box>
  );
}

// ─── Question Card ────────────────────────────────────────────────────────────

function QuestionCard({ question, answers, totalResponses, index }) {
  const [expanded, setExpanded] = useState(false);
  const type = question.type || 'text';
  const responseCount = answers.length;

  const renderAnalysis = () => {
    switch (type) {
      case 'rating':
        return (
          <RatingDistribution
            answers={answers}
            rateMin={question.rateMin ?? 1}
            rateMax={question.rateMax ?? 5}
          />
        );

      case 'radiogroup':
      case 'dropdown':
        return <ChoiceDistribution answers={answers} choices={question.choices} />;

      case 'checkbox':
        return <ChoiceDistribution answers={answers} choices={question.choices} />;

      case 'boolean':
        return <BooleanDistribution answers={answers} />;

      case 'text':
      case 'comment':
        return <TextAnswers answers={answers} />;

      case 'matrix':
        return (
          <MatrixDistribution
            answers={answers}
            rows={question.rows}
            columns={question.columns}
          />
        );

      case 'image_rating':
      case 'imagerating':
      case 'image_ranking':
      case 'imageranking':
      case 'image_boolean':
      case 'imageboolean':
      case 'image_matrix':
      case 'imagematrix':
        return <ImageQuestionAnalysis answers={answers} type={type} question={question} />;

      default:
        // Generic: try choice distribution first, else text
        if (answers.length > 0 && typeof answers[0].answer === 'object') {
          return <TextAnswers answers={answers.map(a => ({ answer: JSON.stringify(a.answer) }))} />;
        }
        return <ChoiceDistribution answers={answers} />;
    }
  };

  const responseRate = pct(responseCount, totalResponses);

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          p: 2,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'grey.50' }
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mr: 1.5,
            flexShrink: 0,
            fontSize: '0.85rem',
            fontWeight: 'bold'
          }}
        >
          {index + 1}
        </Box>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.3 }}>
            {question.title || question.name}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              icon={typeIcon(type)}
              label={type}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.7rem' }}
            />
            <Typography variant="caption" color="text.secondary">
              {responseCount} / {totalResponses} responses ({responseRate}%)
            </Typography>
          </Box>
        </Box>

        <IconButton size="small">
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Divider />
        <CardContent>
          {responseCount === 0 ? (
            <Typography variant="body2" color="text.secondary">No responses for this question yet.</Typography>
          ) : (
            renderAnalysis()
          )}
        </CardContent>
      </Collapse>
    </Card>
  );
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportToCSV(responses, allQuestions) {
  if (!responses.length) return;

  const questionNames = allQuestions.map(q => q.name);

  // For each image question, add a companion "shown_images" column
  const imageTypes = new Set([
    'imagerating', 'image_rating',
    'imageranking', 'image_ranking',
    'imageboolean', 'image_boolean',
    'imagematrix', 'image_matrix',
    'imagepicker'
  ]);
  const isImageQuestion = q => imageTypes.has(q.type);

  // Build header columns: answer column + shown_images column (for image questions)
  const headerCols = [];
  for (const q of allQuestions) {
    headerCols.push(q.name);
    if (isImageQuestion(q)) headerCols.push(`${q.name}__shown_images`);
  }

  const headers = ['participant_id', 'created_at', ...headerCols];

  const rows = responses.map(row => {
    const cols = [
      row.participant_id || '',
      row.created_at || row.survey_metadata?.completion_time || ''
    ];
    for (const q of allQuestions) {
      const qName = q.name;
      const qData = row.responses?.[qName];

      // Answer value
      let ans, shownImgs;
      if (qData !== null && qData !== undefined && typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
        ans = qData.answer;
        shownImgs = qData.shown_images?.length ? qData.shown_images : (row.displayed_images?.[qName] || []);
      } else {
        ans = qData ?? '';
        shownImgs = row.displayed_images?.[qName] || [];
      }

      cols.push(typeof ans === 'object' ? JSON.stringify(ans) : String(ans ?? ''));

      // Shown images column (only for image questions)
      if (isImageQuestion(q)) {
        cols.push(Array.isArray(shownImgs) ? shownImgs.join('|') : String(shownImgs ?? ''));
      }
    }
    return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `survey_responses_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ResultsAnalysis({ currentProject, surveyConfig }) {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null);
  const [searchText, setSearchText] = useState('');

  // Build project-specific Supabase client
  const projectSupabase = useMemo(() => {
    const cfg = currentProject?.imageDatasetConfig;
    if (cfg?.supabaseUrl && cfg?.supabaseKey) {
      try {
        return createClient(cfg.supabaseUrl, cfg.supabaseKey);
      } catch (e) {
        console.error('Failed to create Supabase client for results:', e);
        return null;
      }
    }
    return null;
  }, [currentProject?.imageDatasetConfig?.supabaseUrl, currentProject?.imageDatasetConfig?.supabaseKey]);

  const fetchResponses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (projectSupabase) {
        const { data, error: sbError } = await projectSupabase
          .from('survey_responses')
          .select('*')
          .order('created_at', { ascending: false });
        if (sbError) throw sbError;
        setResponses(data || []);
        setDataSource('supabase');
      } else {
        const resp = await fetch('http://localhost:3001/api/responses');
        if (resp.ok) {
          const json = await resp.json();
          setResponses(json.responses || []);
          setDataSource('file');
        } else {
          setError('Supabase not configured. Please set up the database connection in Step 1 - Image Dataset.');
          setDataSource(null);
        }
      }
    } catch (err) {
      setError(`Failed to load responses: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [projectSupabase]);

  useEffect(() => {
    if (currentProject) fetchResponses();
  }, [currentProject?.id, fetchResponses]);

  // Flatten all questions from survey pages
  const allQuestions = useMemo(() => {
    if (!surveyConfig?.pages) return [];
    return surveyConfig.pages.flatMap(page => page.elements || []);
  }, [surveyConfig]);

  // Filter questions by search
  const filteredQuestions = useMemo(() => {
    if (!searchText.trim()) return allQuestions;
    const lower = searchText.toLowerCase();
    return allQuestions.filter(
      q =>
        (q.title || '').toLowerCase().includes(lower) ||
        (q.name || '').toLowerCase().includes(lower)
    );
  }, [allQuestions, searchText]);

  // Pre-collect answers per question
  const questionAnswers = useMemo(() => {
    const map = {};
    for (const q of allQuestions) {
      map[q.name] = collectAnswers(q.name, responses);
    }
    return map;
  }, [allQuestions, responses]);

  // Stats
  const totalResponses = responses.length;
  const answeredQuestions = allQuestions.filter(q => (questionAnswers[q.name]?.length || 0) > 0).length;

  const dateRange = useMemo(() => {
    if (!responses.length) return null;
    const dates = responses
      .map(r => r.created_at || r.survey_metadata?.completion_time)
      .filter(Boolean)
      .map(d => new Date(d))
      .sort((a, b) => a - b);
    if (!dates.length) return null;
    const fmt = d => d.toLocaleDateString();
    return dates.length === 1
      ? fmt(dates[0])
      : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
  }, [responses]);

  // Build name → URL lookup from preloadedImages
  const imageNameToUrl = useMemo(() => {
    const map = new Map();
    const imgs = currentProject?.preloadedImages || [];
    for (const img of imgs) {
      if (img.name && img.url) map.set(img.name, img.url);
    }
    return map;
  }, [currentProject?.preloadedImages]);

  return (
    <ImageResolverContext.Provider value={imageNameToUrl}>
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 0.5 }}>
            Step 5 – Results Analysis
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Analyze survey responses per question for project: <strong>{currentProject?.name}</strong>
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh responses">
            <IconButton onClick={fetchResponses} disabled={loading} color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<Download />}
            disabled={!responses.length}
            onClick={() => exportToCSV(responses, allQuestions)}
            size="small"
          >
            Export CSV
          </Button>
        </Box>
      </Box>

      {/* Data source badge */}
      {dataSource && (
        <Box sx={{ mb: 2 }}>
          <Chip
            icon={dataSource === 'supabase' ? <Cloud /> : <Storage />}
            label={dataSource === 'supabase' ? 'Connected to Supabase' : 'Reading local response files'}
            color={dataSource === 'supabase' ? 'success' : 'info'}
            variant="outlined"
            size="small"
          />
        </Box>
      )}

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Overview cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <People sx={{ fontSize: 32, color: 'primary.main', mb: 0.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {loading ? '–' : totalResponses}
            </Typography>
            <Typography variant="body2" color="text.secondary">Total Responses</Typography>
            {dateRange && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {dateRange}
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Assessment sx={{ fontSize: 32, color: 'success.main', mb: 0.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {loading ? '–' : allQuestions.length}
            </Typography>
            <Typography variant="body2" color="text.secondary">Total Questions</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {answeredQuestions} with responses
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <QuestionAnswer sx={{ fontSize: 32, color: 'warning.main', mb: 0.5 }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {loading || !totalResponses ? '–' : `${pct(answeredQuestions, allQuestions.length)}%`}
            </Typography>
            <Typography variant="body2" color="text.secondary">Question Coverage</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              avg questions answered
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {/* No survey config */}
      {!loading && !surveyConfig && (
        <Alert severity="info">
          No survey configured. Please set up your survey in Step 2 – Survey Builder first.
        </Alert>
      )}

      {/* No responses yet */}
      {!loading && surveyConfig && totalResponses === 0 && !error && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No responses collected yet. Share your survey link and come back here to view results.
        </Alert>
      )}

      {/* Per-question analysis */}
      {!loading && surveyConfig && allQuestions.length > 0 && (
        <>
          {/* Search */}
          <TextField
            size="small"
            placeholder="Search questions..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
            sx={{ mb: 2, width: 320 }}
          />

          {filteredQuestions.length === 0 && (
            <Typography variant="body2" color="text.secondary">No questions match your search.</Typography>
          )}

          {surveyConfig.pages?.map(page => {
            const pageQuestions = filteredQuestions.filter(q =>
              (page.elements || []).some(e => e.name === q.name)
            );
            if (!pageQuestions.length) return null;
            return (
              <Box key={page.name} sx={{ mb: 3 }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1.5, fontWeight: 'bold', letterSpacing: 1 }}
                >
                  {page.title || page.name}
                </Typography>
                {pageQuestions.map((question, idx) => (
                  <QuestionCard
                    key={question.name}
                    question={question}
                    answers={questionAnswers[question.name] || []}
                    totalResponses={totalResponses}
                    index={allQuestions.indexOf(question)}
                  />
                ))}
              </Box>
            );
          })}
        </>
      )}
    </Box>
    </ImageResolverContext.Provider>
  );
}
