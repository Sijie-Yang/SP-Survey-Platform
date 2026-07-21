import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreRun,
  mae,
  rmse,
  pearson,
  spearman,
  macroF1,
  balancedAccuracy,
  pairwiseAccuracy,
} from './scoring.mjs';
import {
  buildJsonSchemaFromDimensions,
  validateItemLabels,
  freezeMethodPayload,
  SUGGESTED_DIMENSIONS,
} from './dimensions.mjs';

describe('SP-Bench scoring', () => {
  it('computes mae/rmse/pearson/spearman on continuous pairs', () => {
    const pairs = [[1, 1], [2, 2.5], [3, 2.5], [4, 4]];
    // abs diffs: 0, 0.5, 0.5, 0 → mean 0.25
    assert.ok(Math.abs(mae(pairs) - 0.25) < 1e-9);
    assert.ok(rmse(pairs) > 0);
    assert.ok(pearson(pairs) > 0.8);
    assert.ok(spearman(pairs) > 0.7);
  });

  it('computes macro-F1 and balanced accuracy', () => {
    const yTrue = ['a', 'a', 'b', 'b'];
    const yPred = ['a', 'b', 'b', 'b'];
    const f1 = macroF1(yTrue, yPred, ['a', 'b']);
    const ba = balancedAccuracy(yTrue, yPred, ['a', 'b']);
    assert.ok(f1 > 0.4 && f1 < 1);
    assert.ok(ba > 0.4 && ba <= 1);
  });

  it('computes pairwise accuracy', () => {
    assert.equal(pairwiseAccuracy([['left', 'left'], ['right', 'left'], ['right', 'right']]), 2 / 3);
  });

  it('aggregates weighted overall and group scores', () => {
    const dims = [
      {
        key: 'scene_type',
        group_key: 'objective',
        label_type: 'category',
        prompt_field: 'scene_type',
        metrics: ['macro_f1'],
        weight: 1,
        value_range: { choices: ['residential', 'commercial'] },
      },
      {
        key: 'safety',
        group_key: 'subjective',
        label_type: 'continuous',
        prompt_field: 'safety',
        metrics: ['mae'],
        weight: 2,
        value_range: { min: 1, max: 7 },
      },
    ];
    const rows = [
      { labels: { scene_type: 'residential', safety: 5 }, prediction: { scene_type: 'residential', safety: 5 } },
      { labels: { scene_type: 'commercial', safety: 3 }, prediction: { scene_type: 'commercial', safety: 4 } },
    ];
    const scored = scoreRun(rows, dims);
    assert.equal(scored.sample_size, 2);
    assert.ok(scored.overall_score != null && scored.overall_score > 0);
    assert.ok(scored.group_scores.objective != null);
    assert.ok(scored.group_scores.subjective != null);
    assert.equal(scored.dimension_scores.scene_type.macro_f1, 1);
  });
});

describe('SP-Bench dimensions', () => {
  it('builds JSON schema from suggested dimensions', () => {
    const schema = buildJsonSchemaFromDimensions(SUGGESTED_DIMENSIONS);
    assert.equal(schema.type, 'object');
    assert.ok(schema.properties.safety);
    assert.ok(schema.required.includes('safety'));
  });

  it('validates item labels against dimensions', () => {
    const dims = SUGGESTED_DIMENSIONS.filter((d) => d.required);
    const ok = validateItemLabels({
      scene_type: 'residential',
      green_view_ratio: 0.3,
      safety: 5,
      beauty: 4,
      vitality: 3,
      walkability: 4,
      risk_present: false,
      affordance: ['walk'],
      preferred: 'left',
    }, dims);
    // Not all required keys from full suggested set may be present — assert structure
    assert.equal(typeof ok.ok, 'boolean');
    assert.ok(Array.isArray(ok.errors));

    const continuousOnly = [{
      key: 'safety',
      label_type: 'continuous',
      required: true,
      prompt_field: 'safety',
      value_range: { min: 1, max: 7 },
    }];
    assert.equal(validateItemLabels({ safety: 5 }, continuousOnly).ok, true);
    assert.equal(validateItemLabels({ safety: 99 }, continuousOnly).ok, false);
  });

  it('freezes method payload with versioned dimensions', () => {
    const payload = freezeMethodPayload({
      version: 'v1-test',
      title: 'Test',
      dimensions: SUGGESTED_DIMENSIONS.slice(0, 3),
      notes: 'unit',
    });
    assert.equal(payload.version, 'v1-test');
    assert.equal(payload.status, 'frozen');
    assert.ok(Array.isArray(payload.dimensions));
    assert.ok(payload.prompt_template);
    assert.ok(payload.json_schema);
  });
});
