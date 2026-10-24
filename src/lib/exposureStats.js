// How often each media file was actually shown, per question, from stored responses.
import { mediaDisplayName } from './mediaIdentity.js';
import { expandQuestionAnswerUnits } from './responseAnswerUnits.js';

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Per question: distinct files shown and the spread of times shown (answered trials only). */
export function mediaExposureSummary(questions, rows, { skip = new Set() } = {}) {
  const out = [];
  (questions || []).forEach((q) => {
    if (!q?.name || skip.has(q.name)) return;
    const counts = new Map();
    (rows || []).forEach((row) => {
      expandQuestionAnswerUnits(row, q.name, { requireAnswer: true }).forEach((unit) => {
        const ids = unit.shown_media_ids?.length ? unit.shown_media_ids : (unit.shown_images || []).map(mediaDisplayName);
        new Set(ids.filter(Boolean)).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
      });
    });
    if (counts.size < 2) return;
    const values = [...counts.values()];
    const least = [...counts.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([name, n]) => ({ name, n }));
    out.push({
      name: q.name,
      title: q.title || q.name,
      files: counts.size,
      min: Math.min(...values),
      median: median(values),
      max: Math.max(...values),
      uneven: Math.min(...values) * 2 < Math.max(...values),
      least,
    });
  });
  return out;
}
