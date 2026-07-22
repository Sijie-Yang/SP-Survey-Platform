/**
 * Slim preset → resultSchema snapshots for MCP hydrate (mirror of src/lib/presetSkills.js).
 * Keep keys in sync when preset contracts change.
 */

export const PRESET_RESULT_SCHEMAS = {
  image_preference_slider: [
    { key: 'preference', label: 'Preference score (-100 = A, +100 = B)', type: 'number' },
    { key: 'interpretation', label: 'Preference direction', type: 'choice' },
    { key: 'hardToDecide', label: 'Hard to decide', type: 'boolean' },
  ],
  image_preference_forced: [
    { key: 'choice', label: 'Chosen side (A or B)', type: 'choice' },
    { key: 'chosenIndex', label: 'Chosen index (0=A, 1=B)', type: 'number' },
  ],
  video_moment_tag: [
    { key: 'segments', label: 'Key moments marked', type: 'count' },
    { key: 'duration', label: 'Video duration (s)', type: 'number' },
  ],
  emotion_color_picker: [
    { key: 'color.hex', label: 'Emotion color', type: 'color' },
    { key: 'color.hue', label: 'Hue (0–360)', type: 'number' },
    { key: 'color.intensity', label: 'Derived intensity (0–100)', type: 'number' },
    { key: 'color.optionId', label: 'Palette option id', type: 'string' },
    { key: 'color.label', label: 'Palette option label', type: 'string' },
    { key: 'color.source', label: 'palette / wheel / image', type: 'string' },
  ],
  best_worst_choice: [
    { key: 'bestIndex', label: 'Best option index', type: 'number' },
    { key: 'worstIndex', label: 'Worst option index', type: 'number' },
    { key: 'complete', label: 'Both selections made', type: 'boolean' },
  ],
  video_continuous_rating: [
    { key: 'sampleCount', label: 'Rating samples', type: 'number' },
    { key: 'mean', label: 'Mean rating (0–100)', type: 'number' },
  ],
  composite_blocks: [
    { key: 'ratings', label: 'Slider ratings', type: 'scaleGroup' },
    { key: 'words', label: 'Selected words', type: 'count' },
    { key: 'choice', label: 'Choice answer', type: 'choice' },
    { key: 'text', label: 'Free text', type: 'text' },
  ],
};

export function getPresetResultSchema(skillId) {
  const id = String(skillId || '').replace(/^preset_/, '');
  return PRESET_RESULT_SCHEMAS[id] || null;
}
