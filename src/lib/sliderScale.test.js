import { dimensionDisplayName, normalizeSliderDimension, persistSliderAliases, sliderScale, sliderGroupAnswerValid } from './sliderScale';
import { validateQuestionSettings } from './designProtocol/validate';
import { trialHasAnswer } from './trialNavigation';

test('dimension display names keep ids stable and fall back for missing labels', () => {
  expect(dimensionDisplayName({ id: 'safe', label: '安全感', left: 'Unsafe', right: 'Safe' })).toBe('安全感');
  expect(dimensionDisplayName({ id: 'safe', left: 'Unsafe', right: 'Safe' })).toBe('Unsafe ↔ Safe');
  expect(dimensionDisplayName({ id: 'dim_1' }, 0)).toBe('Dimension 1');
  expect(dimensionDisplayName({ id: 'dim_2' }, 1, { locale: 'zh' })).toBe('维度 2');
  expect(normalizeSliderDimension({ name: '舒适度' }, 0)).toMatchObject({
    id: '舒适度',
    label: '舒适度',
  });
  expect(normalizeSliderDimension({ name: '舒适度' }, 0).left).toBeUndefined();
  expect(normalizeSliderDimension({ value: 'greenery', text: '绿化感' }, 0)).toMatchObject({
    id: 'greenery',
    label: '绿化感',
  });
  expect(normalizeSliderDimension({ id: 'safe', value: 'other', text: '安全感' }, 0).id).toBe('safe');
  expect(dimensionDisplayName({ value: 'greenery', text: '绿化感' })).toBe('绿化感');
  expect(persistSliderAliases({
    pages: [{ elements: [{ type: 'slidergroup', dimensions: [{ value: 'greenery', text: '绿化感', left: '少', right: '多' }] }] }],
  }).pages[0].elements[0].dimensions[0]).toMatchObject({
    id: 'greenery',
    label: '绿化感',
    left: '少',
    right: '多',
  });
});

test('dimension overrides use inherited bounds and a reachable midpoint', () => {
  expect(sliderScale({ min: 0, step: 0.5 }, { scaleMax: 3 })).toMatchObject({ min: 0, max: 3, step: 0.5, midpoint: 1.5 });
  expect(sliderScale({}, { scaleMin: 0, scaleMax: 5, scaleStep: 2 }).midpoint).toBe(2);
});
test('settings reject reversed and inherited invalid ranges, but unlimited caps remain valid', () => {
  expect(validateQuestionSettings({ type: 'slidergroup', scaleMin: 7, scaleMax: 1 }).length).toBeGreaterThan(0);
  expect(validateQuestionSettings({ minAnnotations: 5, maxAnnotations: 1 }).length).toBeGreaterThan(0);
  expect(validateQuestionSettings({ minAnnotations: 5, maxAnnotations: 0 })).toEqual([]);
  expect(validateQuestionSettings({ minSelectedChoices: 2, maxSelectedChoices: 0 })).toEqual([]);
  expect(validateQuestionSettings({ scaleMax: 7, dimensions: [{ id: 'x', min: 8 }] }).length).toBeGreaterThan(0);
  expect(validateQuestionSettings({ scaleStep: 0, minAnnotations: 1.5 })).toHaveLength(2);
});
test('trial completion requires all dimensions and respects zero, steps and finite ranges', () => {
  const question = { type: 'imageslidergroup', scaleMin: 0, scaleMax: 3, scaleStep: 0.5, dimensions: [{ id: 'a' }, { id: 'b' }] };
  expect(trialHasAnswer({ value: { a: 0 } }, question)).toBe(false);
  expect(trialHasAnswer({ value: { a: 0, b: 1.5 } }, question)).toBe(true);
  expect(sliderGroupAnswerValid({ a: 0, b: 1.2 }, question, true)).toBe(false);
  expect(sliderGroupAnswerValid({ a: 0, b: 4 }, question, true)).toBe(false);
  expect(sliderGroupAnswerValid({ a: 0 }, question)).toBe(true);
});
