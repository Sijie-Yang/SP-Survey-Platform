import {
  movePage,
  moveQuestion,
  updatePageText,
  updateQuestionText,
  updateSurveyText,
} from './viewportLayout';

function plainText(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => (
    vars[key] != null ? String(vars[key]) : ''
  ));
}

function bindEditable(el, { label, kind, onCommit, placeholder }) {
  if (!el || el.dataset.spEditBound === '1') return;
  el.dataset.spEditBound = '1';
  el.dataset.spEdit = kind;
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.setAttribute('role', 'textbox');
  if (label) el.setAttribute('aria-label', label);
  if (placeholder) el.dataset.spPlaceholder = placeholder;
  el.dataset.spEditValue = plainText(el);
  const commit = () => {
    const value = plainText(el);
    if (value === el.dataset.spEditValue) return;
    el.dataset.spEditValue = value;
    onCommit(value);
  };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.blur();
    }
  });
}

function reorderButton(label, text, onClick, disabled) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.setAttribute('aria-label', label);
  el.disabled = !!disabled;
  el.style.cssText = [
    'font:inherit',
    'font-size:13px',
    'font-weight:600',
    'line-height:1.2',
    'padding:6px 10px',
    'border:1px solid #c8c8c8',
    'background:#fff',
    'border-radius:6px',
    'color:#1a1a1a',
    'white-space:nowrap',
    disabled ? 'opacity:0.38;cursor:default' : 'cursor:pointer',
  ].join(';');
  el.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!el.disabled) onClick();
  });
  return el;
}

function reorderBar(kind, caption) {
  const bar = document.createElement('div');
  bar.dataset.spReorder = kind;
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:8px 10px;border:1px solid #d5d5d5;border-left:4px solid #1976d2;border-radius:8px;background:#f4f7fb;';
  const label = document.createElement('span');
  label.dataset.spReorderLabel = kind;
  label.textContent = caption;
  label.title = caption;
  label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:#1a1a1a;';
  bar.appendChild(label);
  return bar;
}

function commitConfig(api, next) {
  if (next && next !== api.getConfig()) api.onConfigChange(next);
}

function questionTitleNode(root) {
  return root.querySelector('.sd-question__title .sv-string-viewer')
    || root.querySelector('.sd-question__title');
}

function pageTitleNode(root) {
  return root.querySelector('.sd-page__title .sv-string-viewer')
    || root.querySelector('.sd-page__title');
}

function questionPlace(config, questionName) {
  const pages = config?.pages || [];
  for (const page of pages) {
    const elements = page.elements || [];
    const index = elements.findIndex((element) => element?.name === questionName);
    if (index >= 0) return { index, count: elements.length };
  }
  return { index: -1, count: 0 };
}

function questionCaption(question, place, labels) {
  const name = String(question?.title || question?.name || '').trim() || question?.name || '';
  return fill(labels.reorderQuestion || 'Question {index} of {count}: {name}', {
    index: Math.max(1, place.index + 1),
    count: Math.max(place.count, 1),
    name,
  });
}

function pageCaption(page, index, count, labels) {
  const name = String(page?.title || page?.name || '').trim() || page?.name || '';
  return fill(labels.reorderPage || 'Page {index} of {count}: {name}', {
    index: Math.max(1, index + 1),
    count: Math.max(count, 1),
    name,
  });
}

function syncCaption(root, kind, caption) {
  const label = root.querySelector(`[data-sp-reorder="${kind}"] [data-sp-reorder-label]`);
  if (!label || label.textContent === caption) return;
  label.textContent = caption;
  label.title = caption;
}

export function attachQuestionEditor(root, question, api) {
  if (!root || !question?.name) return;
  const labels = api.getLabels();
  const place = questionPlace(api.getConfig(), question.name);
  const caption = questionCaption(question, place, labels);
  const title = questionTitleNode(root);
  bindEditable(title, {
    label: labels.questionText,
    kind: 'question-title',
    onCommit: (value) => {
      question.title = value;
      commitConfig(api, updateQuestionText(api.getConfig(), question.name, 'title', value));
    },
  });
  const description = root.querySelector('.sd-question__description .sv-string-viewer')
    || root.querySelector('.sd-question__description');
  if (description) {
    bindEditable(description, {
      label: labels.questionDescription,
      kind: 'question-description',
      onCommit: (value) => {
        question.description = value;
        commitConfig(api, updateQuestionText(api.getConfig(), question.name, 'description', value));
      },
    });
  }
  if (root.querySelector('[data-sp-reorder="question"]')) {
    syncCaption(root, 'question', caption);
    return;
  }
  const bar = reorderBar('question', caption);
  bar.append(
    reorderButton(labels.moveQuestionUp, labels.moveUp || 'Move up', () => {
      commitConfig(api, moveQuestion(api.getConfig(), question.name, -1));
    }, place.index <= 0),
    reorderButton(labels.moveQuestionDown, labels.moveDown || 'Move down', () => {
      commitConfig(api, moveQuestion(api.getConfig(), question.name, 1));
    }, place.index < 0 || place.index >= place.count - 1),
  );
  const header = root.querySelector('.sd-question__header') || root;
  header.prepend(bar);
}

export function attachPageEditor(root, page, api) {
  if (!root || !page?.name) return;
  const labels = api.getLabels();
  let title = pageTitleNode(root);
  if (!title) {
    title = document.createElement('div');
    title.className = 'sd-page__title';
    const viewer = document.createElement('span');
    viewer.className = 'sv-string-viewer';
    viewer.textContent = page.title || labels.pageTitle;
    title.appendChild(viewer);
    root.prepend(title);
    title = viewer;
  }
  bindEditable(title, {
    label: labels.pageTitle,
    kind: 'page-title',
    onCommit: (value) => {
      page.title = value;
      commitConfig(api, updatePageText(api.getConfig(), page.name, 'title', value));
    },
  });
  const description = root.querySelector('.sd-page__description .sv-string-viewer')
    || root.querySelector('.sd-page__description');
  if (description) {
    bindEditable(description, {
      label: labels.pageDescription,
      kind: 'page-description',
      onCommit: (value) => {
        page.description = value;
        commitConfig(api, updatePageText(api.getConfig(), page.name, 'description', value));
      },
    });
  }
  const pages = api.getConfig()?.pages || [];
  const index = pages.findIndex((item) => item?.name === page.name);
  const caption = pageCaption(page, index, pages.length, labels);
  if (root.querySelector('[data-sp-reorder="page"]')) {
    syncCaption(root, 'page', caption);
    return;
  }
  const bar = reorderBar('page', caption);
  bar.append(
    reorderButton(labels.movePageUp, labels.moveUp || 'Move up', () => {
      commitConfig(api, movePage(api.getConfig(), page.name, -1));
    }, index <= 0),
    reorderButton(labels.movePageDown, labels.moveDown || 'Move down', () => {
      commitConfig(api, movePage(api.getConfig(), page.name, 1));
    }, index < 0 || index >= pages.length - 1),
  );
  root.prepend(bar);
}

function ensureSurveyDescription(header) {
  const viewer = header.querySelector('.sd-header__text .sd-description .sv-string-viewer')
    || header.querySelector('.sd-description .sv-string-viewer');
  const fallback = header.querySelector('[data-sp-description-fallback]');
  if (viewer && !viewer.closest('[data-sp-description-fallback]')) {
    fallback?.remove();
    return viewer;
  }
  if (fallback) return fallback.querySelector('.sv-string-viewer');
  const h5 = document.createElement('h5');
  h5.className = 'sd-description';
  h5.dataset.spDescriptionFallback = '1';
  h5.style.margin = '0';
  const created = document.createElement('span');
  created.className = 'sv-string-viewer';
  h5.appendChild(created);
  (header.querySelector('.sd-header__text') || header).appendChild(h5);
  return created;
}

export function attachSurveyHeader(container, model, api) {
  if (!container || !model) return;
  const header = container.querySelector('.sd-container-modern__title');
  if (!header) return;
  const labels = api.getLabels();
  const title = header.querySelector('.sd-header__text .sd-title .sv-string-viewer')
    || header.querySelector('.sd-header__text .sd-title');
  bindEditable(title, {
    label: labels.editSurveyTitle || labels.surveyTitle,
    kind: 'survey-title',
    onCommit: (value) => {
      model.title = value;
      commitConfig(api, updateSurveyText(api.getConfig(), 'title', value));
    },
  });
  const description = ensureSurveyDescription(header);
  bindEditable(description, {
    label: labels.editSurveyDescription || labels.surveyDescription,
    kind: 'survey-description',
    placeholder: labels.surveyDescription,
    onCommit: (value) => {
      model.description = value;
      commitConfig(api, updateSurveyText(api.getConfig(), 'description', value));
    },
  });
}

export function bindLivePreviewEditing(model, api) {
  const onQuestion = (_sender, options) => attachQuestionEditor(options.htmlElement, options.question, api);
  const onPage = (_sender, options) => attachPageEditor(options.htmlElement, options.page, api);
  const onSurvey = (_sender, options) => attachSurveyHeader(options.htmlElement, model, api);
  model.onAfterRenderQuestion.add(onQuestion);
  model.onAfterRenderPage.add(onPage);
  model.onAfterRenderSurvey.add(onSurvey);
  return () => {
    model.onAfterRenderQuestion.remove(onQuestion);
    model.onAfterRenderPage.remove(onPage);
    model.onAfterRenderSurvey.remove(onSurvey);
  };
}
