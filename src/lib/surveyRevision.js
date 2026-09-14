/* global globalThis */
// Store only the response contract, never integration credentials or dataset secrets.
const CONTRACT_KEYS = ['name', 'type', 'title', 'description', 'choices', 'rows', 'columns', 'dimensions', 'budget', 'rateMin', 'rateMax', 'scaleMin', 'scaleMax', 'scaleStep', 'rateStep', 'inputType', 'min', 'max', 'step', 'annotationLabels', 'allowedTools', 'minAnnotations', 'maxAnnotations', 'minSelectedChoices', 'maxSelectedChoices', 'isAttentionCheck', 'expectedAnswer', 'labelTrue', 'labelFalse', 'minRateDescription', 'maxRateDescription', 'multiSelect', 'allowTie', 'tieLabel', 'trialCount', 'imageCount', 'skillId', 'skillRevision', 'skillResultSchema', 'skillContractVersion', 'isRequired', 'visibleIf', 'enableIf', 'requiredIf', 'mediaType', 'mediaAssignmentMode', 'mediaFolders', 'mediaPerCategory', 'mediaCategoryMode', 'excludePreviouslyUsedImages', 'imageSelectionMode', 'randomImageSelection', 'pairingMode', 'selectedImageUrls', 'mediaSlots', 'mediaPresentation', 'displayMode', 'exposureSeconds', 'imageFit', 'numericMeasure', 'maxLength'];

const SKILL_CONFIG_KEYS = ['min', 'max', 'step', 'rateMin', 'rateMax', 'scaleMin', 'scaleMax', 'scaleStep', 'choices', 'options', 'rows', 'columns', 'dimensions', 'budget', 'labels', 'mediaType', 'mediaCount'];
const STATIC_MEDIA_KEYS = ['imageLink', 'imageLinks', 'mediaUrl', 'mediaUrls', 'mediaItems', 'beforeLabel', 'afterLabel'];

export function surveyResponseContract(config, resolvedConfig = null) {
  const resolved = new Map((resolvedConfig?.pages || []).flatMap((p) => p.elements || []).map((q) => [q.name, q]));
  const contract = {
    version: 2,
    title: config?.title || '',
    locale: config?.locale || 'en',
    questions: (config?.pages || []).flatMap((p) => p.elements || []).map((q) => {
      const live = resolved.get(q.name);
      if (q.type === 'skillquestion' && live) {
        q = { ...q, ...Object.fromEntries(['skillId', 'skillRevision', 'skillContractVersion', 'skillResultSchema', 'skillConfig']
          .filter((k) => live[k] !== undefined).map((k) => [k, live[k]])) };
      }
      const result = Object.fromEntries([...CONTRACT_KEYS, ...STATIC_MEDIA_KEYS].filter((k) => q[k] !== undefined).map((k) => [k, q[k]]));
      if (q.type === 'skillquestion' && q.skillConfig) {
        result.skillConfig = Object.fromEntries(SKILL_CONFIG_KEYS.filter((k) => q.skillConfig[k] !== undefined).map((k) => [k, q.skillConfig[k]]));
      }
      return result;
    }),
  };
  return JSON.parse(JSON.stringify(contract));
}

export async function surveyRevision(config, resolvedConfig = null) {
  const contract = surveyResponseContract(config, resolvedConfig);
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
