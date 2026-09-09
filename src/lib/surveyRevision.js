/* global globalThis */
// Store only the response contract, never integration credentials or dataset secrets.
const CONTRACT_KEYS = ['name', 'type', 'title', 'description', 'choices', 'rows', 'columns', 'dimensions', 'budget', 'rateMin', 'rateMax', 'scaleMin', 'scaleMax', 'scaleStep', 'rateStep', 'inputType', 'min', 'max', 'step', 'annotationLabels', 'allowedTools', 'minAnnotations', 'maxAnnotations', 'minSelectedChoices', 'maxSelectedChoices', 'isAttentionCheck', 'expectedAnswer', 'labelTrue', 'labelFalse', 'minRateDescription', 'maxRateDescription', 'multiSelect', 'trialCount', 'imageCount', 'skillId', 'skillRevision', 'skillResultSchema', 'isRequired'];

const SKILL_CONFIG_KEYS = ['min', 'max', 'step', 'rateMin', 'rateMax', 'scaleMin', 'scaleMax', 'scaleStep', 'choices', 'options', 'rows', 'columns', 'dimensions', 'budget', 'labels', 'mediaType', 'mediaCount'];

export function surveyResponseContract(config) {
  return {
    locale: config?.locale || 'en',
    questions: (config?.pages || []).flatMap((p) => p.elements || []).map((q) => {
      const result = Object.fromEntries(CONTRACT_KEYS.filter((k) => q[k] !== undefined).map((k) => [k, q[k]]));
      if (q.type === 'skillquestion' && q.skillConfig) {
        result.skillConfig = Object.fromEntries(SKILL_CONFIG_KEYS.filter((k) => q.skillConfig[k] !== undefined).map((k) => [k, q.skillConfig[k]]));
      }
      return result;
    }),
  };
}

export async function surveyRevision(config) {
  const contract = surveyResponseContract(config);
  const data = new TextEncoder().encode(JSON.stringify(contract));
  if (!globalThis.crypto?.subtle) {
    // Local phone testing over HTTP may not provide Web Crypto; never block a survey.
    let a = 2166136261; let b = 3339675911;
    for (const byte of data) { a = Math.imul(a ^ byte, 16777619); b = Math.imul(b ^ byte, 2246822519); }
    return { id: 'contract-v1:' + (a >>> 0).toString(16) + (b >>> 0).toString(16), contract };
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return { id: 'sha256:' + Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''), contract };
}
