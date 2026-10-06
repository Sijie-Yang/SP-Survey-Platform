/**
 * Question and page descriptions are plain SurveyJS text unless markdown is
 * enabled on that localizable string. Titles already opt in; descriptions do not.
 */

const attached = new WeakSet();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(escaped) {
  return escaped
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}

export function descriptionMarkdownToHtml(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return '';
  return source.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-*]\s+\S/.test(line))) {
      const items = lines.map((line) => `<li>${inlineMarkdown(escapeHtml(line.replace(/^\s*[-*]\s+/, '')))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    if (lines.every((line) => /^\s*\d+\.\s+\S/.test(line))) {
      const items = lines.map((line) => `<li>${inlineMarkdown(escapeHtml(line.replace(/^\s*\d+\.\s+/, '')))}</li>`).join('');
      return `<ol>${items}</ol>`;
    }
    const body = lines.map((line) => inlineMarkdown(escapeHtml(line))).join('<br>');
    return `<p>${body}</p>`;
  }).join('');
}

function enableDescriptionMarkdown(element) {
  const loc = element?.locDescription;
  if (loc) loc.useMarkdown = true;
}

export function attachSurveyMarkdown(model) {
  if (!model?.onTextMarkdown?.add || attached.has(model)) return;
  attached.add(model);
  model.onTextMarkdown.add((_, options) => {
    if (options.name !== 'description') return;
    const html = descriptionMarkdownToHtml(options.text);
    if (html) options.html = html;
  });
  enableDescriptionMarkdown(model);
  (model.pages || []).forEach((page) => enableDescriptionMarkdown(page));
  if (typeof model.getAllPanels === 'function') model.getAllPanels().forEach(enableDescriptionMarkdown);
  if (typeof model.getAllQuestions === 'function') model.getAllQuestions().forEach(enableDescriptionMarkdown);
  model.onQuestionAdded?.add?.((_, options) => enableDescriptionMarkdown(options.question));
  model.onPanelAdded?.add?.((_, options) => enableDescriptionMarkdown(options.panel));
}
