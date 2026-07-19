import {
  sanitizeForAgent,
  findSecretFields,
  restoreStoredSecrets,
  validateSurveyConfig,
  postProcessAiConfig,
  applyOperations,
  createDefaultSurveyConfig,
  isSafeProjectId,
} from './index';

describe('designProtocol secrets', () => {
  test('strips secret fields', () => {
    const cleaned = sanitizeForAgent({
      title: 'A',
      huggingFaceToken: 'secret',
      nested: { apiKey: 'x', keep: 1 },
    });
    expect(cleaned).toEqual({ title: 'A', nested: { keep: 1 } });
  });

  test('finds secret field paths', () => {
    const paths = findSecretFields({ openaiApiKey: 'a', pages: [{ falApiKey: 'b' }] });
    expect(paths).toEqual(expect.arrayContaining(['openaiApiKey', 'pages[0].falApiKey']));
  });

  test('restores stored secrets after agent replace', () => {
    const restored = restoreStoredSecrets(
      { title: 'new', huggingFaceToken: 'attempt' },
      { title: 'old', huggingFaceToken: 'kept' },
    );
    expect(restored.huggingFaceToken).toBe('kept');
    expect(restored.title).toBe('new');
  });
});

describe('designProtocol validate', () => {
  test('rejects missing pages', () => {
    const report = validateSurveyConfig({});
    expect(report.valid).toBe(false);
  });

  test('flags duplicate question names', () => {
    const report = validateSurveyConfig({
      pages: [{
        name: 'p1',
        elements: [
          { type: 'text', name: 'q1' },
          { type: 'text', name: 'q1' },
        ],
      }],
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  test('accepts a default config', () => {
    const report = validateSurveyConfig(createDefaultSurveyConfig('Demo'));
    expect(report.valid).toBe(true);
  });
});

describe('designProtocol normalize + operations', () => {
  test('postProcessAiConfig sets image defaults', () => {
    const out = postProcessAiConfig({
      pages: [{
        name: 'p1',
        elements: [{ type: 'imagerating', name: 'r1', imageSelectionMode: 'random' }],
      }],
    });
    expect(out.pages[0].elements[0].imageSelectionMode).toBe('huggingface_random');
    expect(out.pages[0].elements[0].choices).toEqual([]);
  });

  test('postProcessAiConfig normalizes media* and skillquestion', () => {
    const out = postProcessAiConfig({
      pages: [{
        name: 'p1',
        elements: [
          { type: 'mediapicker', name: 'm1' },
          {
            type: 'skillquestion',
            name: 's1',
            skillId: 'image_preference_slider',
            skillConfig: { mediaCount: 2 },
            skillHtml: '<html>nope</html>',
          },
        ],
      }],
    });
    const media = out.pages[0].elements[0];
    expect(media.imageSelectionMode).toBe('huggingface_random');
    expect(media.mediaSlots).toEqual([]);
    expect(media.mediaPresentation).toBe('stack');
    const skill = out.pages[0].elements[1];
    expect(skill.skillId).toBe('preset_image_preference_slider');
    expect(skill.imageCount).toBe(2);
    expect(skill.skillHtml).toBeUndefined();
  });

  test('applyOperations add/remove question with inverse', () => {
    const base = createDefaultSurveyConfig('Demo');
    const result = applyOperations(base, [{
      op: 'addQuestion',
      pageName: 'page1',
      question: { type: 'text', name: 'age', title: 'Age' },
    }]);
    expect(result.validation.valid).toBe(true);
    expect(result.surveyConfig.pages[0].elements).toHaveLength(1);

    const undone = applyOperations(result.surveyConfig, result.inverse);
    expect(undone.surveyConfig.pages[0].elements).toHaveLength(0);
  });

  test('isSafeProjectId', () => {
    expect(isSafeProjectId('proj_123_abc')).toBe(true);
    expect(isSafeProjectId('../evil')).toBe(false);
  });
});
