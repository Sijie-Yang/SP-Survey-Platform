import { Model } from 'survey-core';
import { applySurveyLocale } from './surveyLocale';
import { descriptionMarkdownToHtml } from './surveyMarkdown';

describe('question description markdown', () => {
  test('turns blank lines, bold and lists into html and escapes markup', () => {
    const html = descriptionMarkdownToHtml('**Imageability** is distinct.\n\n- Enclosure\n- Human scale\n\n<script>alert(1)</script>');
    expect(html).toBe('<p><strong>Imageability</strong> is distinct.</p><ul><li>Enclosure</li><li>Human scale</li></ul><p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  test('a plain sentence stays one paragraph', () => {
    expect(descriptionMarkdownToHtml('Watch the clip, then rate it.')).toBe('<p>Watch the clip, then rate it.</p>');
  });

  test('survey descriptions opt into markdown; titles stay researcher text', () => {
    const model = new Model({
      description: '**Study** introduction.',
      elements: [{
        type: 'text',
        name: 'q',
        title: '**not bold**',
        description: '**Imageability** is one.\n\n**Enclosure** is two.',
      }],
    });
    applySurveyLocale(model, {});
    const question = model.getQuestionByName('q');
    expect(question.locDescription.useMarkdown).toBe(true);
    expect(question.locDescription.hasHtmlValue()).toBe(true);
    expect(question.locDescription.getHtmlValue()).toBe('<p><strong>Imageability</strong> is one.</p><p><strong>Enclosure</strong> is two.</p>');
    expect(question.locTitle.hasHtmlValue()).toBe(false);
    expect(model.locDescription.hasHtmlValue()).toBe(true);
    expect(model.locDescription.getHtmlValue()).toBe('<p><strong>Study</strong> introduction.</p>');
  });
});
