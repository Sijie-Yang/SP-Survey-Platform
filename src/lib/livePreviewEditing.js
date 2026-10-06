import { movePage, moveQuestion, updatePageText, updateQuestionText } from './viewportLayout';

function plainText(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function bindEditable(el, { label, kind, onCommit }) {
  if (!el || el.dataset.spEditBound === '1') return;
  el.dataset.spEditBound = '1';
  el.dataset.spEdit = kind;
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.setAttribute('role', 'textbox');
  if (label) el.setAttribute('aria-label', label);
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

function reorderButton(label, symbol, onClick, disabled) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = symbol;
  el.setAttribute('aria-label', label);
  el.disabled = !!disabled;
  el.style.cssText = 'font:inherit;font-size:12px;line-height:1;padding:2px 6px;border:1px solid #d0d0d0;background:#fff;border-radius:4px;cursor:pointer;color:#333;';
  el.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!el.disabled) onClick();
  });
  return el;
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

export function attachQuestionEditor(root, question, api) {
  if (!root || !question?.name || root.querySelector('[data-sp-reorder="question"]')) {
    const title = root ? questionTitleNode(root) : null;
    if (title && title.dataset.spEditBound !== '1') {
      const labels = api.getLabels();
      bindEditable(title, {
        label: labels.questionText,
        kind: 'question-title',
        onCommit: (value) => {
          question.title = value;
          commitConfig(api, updateQuestionText(api.getConfig(), question.name, 'title', value));
        },
      });
    }
    return;
  }
  const labels = api.getLabels();
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
  const pages = api.getConfig()?.pages || [];
  let index = -1;
  let count = 0;
  for (const page of pages) {
    const elements = page.elements || [];
    const found = elements.findIndex((element) => element?.name === question.name);
    if (found >= 0) {
      index = found;
      count = elements.length;
      break;
    }
  }
  const bar = document.createElement('div');
  bar.dataset.spReorder = 'question';
  bar.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;margin:0 0 4px;';
  bar.append(
    reorderButton(labels.moveQuestionUp, '↑', () => {
      commitConfig(api, moveQuestion(api.getConfig(), question.name, -1));
    }, index <= 0),
    reorderButton(labels.moveQuestionDown, '↓', () => {
      commitConfig(api, moveQuestion(api.getConfig(), question.name, 1));
    }, index < 0 || index >= count - 1),
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
  if (root.querySelector('[data-sp-reorder="page"]')) return;
  const pages = api.getConfig()?.pages || [];
  const index = pages.findIndex((item) => item?.name === page.name);
  const bar = document.createElement('div');
  bar.dataset.spReorder = 'page';
  bar.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;margin:0 0 4px;';
  bar.append(
    reorderButton(labels.movePageUp, '↑', () => {
      commitConfig(api, movePage(api.getConfig(), page.name, -1));
    }, index <= 0),
    reorderButton(labels.movePageDown, '↓', () => {
      commitConfig(api, movePage(api.getConfig(), page.name, 1));
    }, index < 0 || index >= pages.length - 1),
  );
  root.prepend(bar);
}

export function bindLivePreviewEditing(model, api) {
  const onQuestion = (_sender, options) => attachQuestionEditor(options.htmlElement, options.question, api);
  const onPage = (_sender, options) => attachPageEditor(options.htmlElement, options.page, api);
  model.onAfterRenderQuestion.add(onQuestion);
  model.onAfterRenderPage.add(onPage);
  return () => {
    model.onAfterRenderQuestion.remove(onQuestion);
    model.onAfterRenderPage.remove(onPage);
  };
}
