import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Button, Typography, FormControlLabel, Checkbox, FormGroup,
  TextField, LinearProgress, Alert, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Collapse,
} from '@mui/material';
import { PlayArrow, Stop } from '@mui/icons-material';
import { ABLATION_MODELS, runPerceptionAblation, isAbortError } from '../../lib/perceptionAblation';

/**
 * Multi-model ablation under Image × Perception (VIF + linear / RF / GBM / MLP).
 * Runs only on explicit Run; AbortController for Stop.
 */
export default function PerceptionAblationPanel({
  rows,
  modelFilter = 'all',
  scoreLabel = 'Score',
  disabled = false,
}) {
  const [selectedModels, setSelectedModels] = useState(() => (
    ABLATION_MODELS.map((m) => m.id)
  ));
  const [vifMax, setVifMax] = useState(10);
  const [testFraction, setTestFraction] = useState(0.25);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [showVif, setShowVif] = useState(false);
  const abortRef = useRef(null);
  const runIdRef = useRef(0);

  const scoredN = useMemo(
    () => (rows || []).filter((r) => r.mean_score != null && r.n_ratings > 0).length,
    [rows],
  );

  const toggleModel = (id) => {
    setSelectedModels((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleRun = async () => {
    if (running) return;
    if (!selectedModels.length) {
      setError('Select at least one model.');
      return;
    }
    // Cancel any prior run without relying on unmount cleanup (Strict Mode safe).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setRunning(true);
    setError(null);
    setProgress({ message: 'Starting…', pct: 0 });
    setResult(null);
    try {
      const out = await runPerceptionAblation({
        rows: (rows || []).map((r) => ({ ...r })),
        modelFilter,
        models: [...selectedModels],
        vifMax: Number(vifMax) || 10,
        testFraction: Math.min(0.5, Math.max(0.1, Number(testFraction) || 0.25)),
        signal: controller.signal,
        onProgress: (p) => {
          if (runIdRef.current !== runId) return;
          setProgress({ message: p.message, pct: p.pct, phase: p.phase, model: p.model });
        },
      });
      if (runIdRef.current === runId && !controller.signal.aborted) {
        setResult(out);
      }
    } catch (err) {
      if (runIdRef.current !== runId) return;
      if (isAbortError(err)) {
        setError('Stopped.');
        setProgress(null);
      } else {
        setError(err?.message || String(err));
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Multi-model ablation
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        VIF feature screen → predict {scoreLabel} with OLS / Ridge / Lasso / Elastic Net /
        Random Forest / Gradient Boosting (XGBoost-style) / MLP. Runs in the browser; click Run
        to start, Stop to cancel. Uses current Features filter ({modelFilter}).
      </Typography>

      <FormGroup row sx={{ mb: 1.5, gap: 0.5 }}>
        {ABLATION_MODELS.map((m) => (
          <FormControlLabel
            key={m.id}
            control={(
              <Checkbox
                size="small"
                checked={selectedModels.includes(m.id)}
                onChange={() => toggleModel(m.id)}
                disabled={running}
              />
            )}
            label={<Typography variant="body2">{m.label}</Typography>}
          />
        ))}
      </FormGroup>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', mb: 1.5 }}>
        <TextField
          size="small"
          label="Max VIF"
          type="number"
          value={vifMax}
          onChange={(e) => setVifMax(e.target.value)}
          disabled={running}
          inputProps={{ min: 2, max: 50, step: 0.5 }}
          sx={{ width: 110 }}
        />
        <TextField
          size="small"
          label="Test holdout"
          type="number"
          value={testFraction}
          onChange={(e) => setTestFraction(e.target.value)}
          disabled={running}
          inputProps={{ min: 0.1, max: 0.5, step: 0.05 }}
          sx={{ width: 120 }}
        />
        <Chip size="small" label={`Scored rows: ${scoredN}`} />
        <Box sx={{ flex: 1 }} />
        {!running ? (
          <Button
            variant="contained"
            size="small"
            startIcon={<PlayArrow />}
            onClick={handleRun}
            disabled={disabled || scoredN < 12 || !selectedModels.length}
          >
            Run ablation
          </Button>
        ) : (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<Stop />}
            onClick={handleStop}
          >
            Stop
          </Button>
        )}
      </Box>

      {running && (
        <Box sx={{ mb: 1.5 }}>
          <LinearProgress
            variant={progress?.pct != null ? 'determinate' : 'indeterminate'}
            value={progress?.pct ?? 0}
            sx={{ mb: 0.5 }}
          />
          <Typography variant="caption" color="text.secondary">
            {progress?.message || 'Running…'}
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity={error === 'Stopped.' ? 'warning' : 'error'} sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      {result && (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Kept <strong>{result.nFeaturesOut}</strong> / {result.nFeaturesIn} features after VIF
            (dropped {result.vifDropped?.length || 0}).
            Train n={result.nTrain}, test n={result.nTest}.
            {' '}
            <Button size="small" onClick={() => setShowVif((v) => !v)}>
              {showVif ? 'Hide VIF' : 'Show VIF'}
            </Button>
          </Typography>

          <Collapse in={showVif}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {!!result.vifDropped?.length && (
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="caption" color="text.secondary">Dropped (high VIF)</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {result.vifDropped.map((d) => (
                      <Chip
                        key={d.feature}
                        size="small"
                        label={`${d.feature}${d.vif != null ? ` (${d.vif.toFixed(1)})` : ''}`}
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Box>
              )}
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="caption" color="text.secondary">Kept VIF</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {(result.vifKept || []).slice(0, 24).map((d) => (
                    <Chip
                      key={d.feature}
                      size="small"
                      label={`${d.feature}${d.vif != null ? ` (${d.vif.toFixed(1)})` : ''}`}
                      color="success"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Box>
            </Box>
          </Collapse>

          <TableContainer sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Model</TableCell>
                  <TableCell align="right">Test R²</TableCell>
                  <TableCell align="right">Test RMSE</TableCell>
                  <TableCell align="right">Test MAE</TableCell>
                  <TableCell align="right">Train R²</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.results.map((r) => (
                  <TableRow key={r.model}>
                    <TableCell>
                      {r.label}
                      {r.note ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {r.note}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">
                      {Number.isFinite(r.test?.r2) ? r.test.r2.toFixed(3) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {Number.isFinite(r.test?.rmse) ? r.test.rmse.toFixed(3) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {Number.isFinite(r.test?.mae) ? r.test.mae.toFixed(3) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {Number.isFinite(r.train?.r2) ? r.train.r2.toFixed(3) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {result.results.map((r) => (
            <Box key={`imp-${r.model}`} sx={{ mb: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {r.label} — top features
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {(r.importance || []).slice(0, 8).map((f) => (
                  <Chip
                    key={`${r.model}-${f.feature}`}
                    size="small"
                    variant="outlined"
                    label={`${f.feature}: ${(f.importance * 100).toFixed(0)}%`}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
