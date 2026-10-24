// Runs a stored experiment design inside a live survey or the admin preview.
import {
  computeDesignId, designSizing, normalizeDesign, questionTrialsForVersion, versionTrials,
} from './experimentDesign.js';
import { normalizeMediaEntry } from './mediaUtils.js';

/** The survey's design, ready to run, or null. */
export function activeDesign(config) {
  const design = normalizeDesign(config?.experimentDesign);
  if (!design || !design.units.length || !design.questions.length) return null;
  return { ...design, id: design.id || computeDesignId(design) };
}

/**
 * Pick this participant's version: from the server when it can (fewest done),
 * otherwise at random in the browser. `claim` is the server call.
 */
export async function assignDesignVersion(design, { claim = null, rand = Math.random } = {}) {
  const { versions } = designSizing(design);
  if (!versions) return null;
  const server = claim ? await claim(design.id, versions) : null;
  const version = server ? server.version : Math.floor(rand() * versions);
  return {
    id: design.id,
    type: design.type,
    seed: design.seed,
    version,
    versions,
    claim: server ? 'server' : 'local',
    claim_id: server?.claimId || null,
  };
}

/** Media library entries keyed the same way a design stores them. */
export function designPoolIndex(pool) {
  const map = new Map();
  (pool || []).forEach((raw) => {
    const entry = normalizeMediaEntry(raw);
    if (!entry) return;
    [entry.media_id, entry.key, entry.name].filter(Boolean).forEach((k) => {
      if (!map.has(k)) map.set(k, entry);
    });
  });
  return map;
}

/**
 * Trial media and per-trial records for one question, or null when the
 * question does not follow the design. `missing` lists files not in the library.
 */
export function designMediaForElement(design, assignment, element, poolIndex) {
  if (!design || !assignment || !element?.name || !design.questions.includes(element.name)) return null;
  const trials = versionTrials(design, assignment.version);
  const perQuestion = questionTrialsForVersion(design, trials, element, {
    designId: design.id,
    version: assignment.version,
  });
  const missing = [];
  const trialMediaSets = perQuestion.map(({ media }) => media.map((key) => {
    const hit = poolIndex.get(key);
    if (!hit) missing.push(key);
    return hit || null;
  }).filter(Boolean));
  return {
    trialMediaSets,
    trialMediaContexts: perQuestion.map(({ context }) => context),
    trialCount: perQuestion.length,
    missing: [...new Set(missing)],
  };
}

/** What a response records about its design version. */
export function designResponseMetadata(assignment) {
  if (!assignment) return {};
  const { id, version, versions, claim, claim_id: claimId, seed, type } = assignment;
  return { experiment_design: { id, type, seed, version, versions, claim, claim_id: claimId } };
}
