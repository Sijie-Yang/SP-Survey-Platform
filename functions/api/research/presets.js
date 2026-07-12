import { json } from '../../_lib/r2.js';
import { PRESET_QUERIES } from '../../_lib/researchProviders.js';

export const onRequestGet = async () => json({
  success: true,
  presets: Object.entries(PRESET_QUERIES).map(([id, query]) => ({ id, query })),
});
