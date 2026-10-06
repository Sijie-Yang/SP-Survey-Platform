/**
 * Per-viewport preview sizes stored on the survey config.
 *
 * `config.viewportLayout.desktop` and `config.viewportLayout.mobile` are
 * independent. Question text and page/question order stay on `pages`, so
 * an edit made while previewing one viewport is the same edit for the other.
 * Participant rendering reads this object from the published survey config.
 */
import { MOBILE_WIDTH } from './imagePickerLayout';

export const VIEWPORT_LAYOUT_DEFAULTS = {
  desktop: { contentWidth: 900, mediaMaxHeight: 480 },
  mobile: { contentWidth: 390, mediaMaxHeight: 320 },
};

export const VIEWPORT_LAYOUT_LIMITS = {
  desktop: { contentWidth: [480, 1400], mediaMaxHeight: [80, 800] },
  mobile: { contentWidth: [280, 480], mediaMaxHeight: [80, 800] },
};

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clampLayoutValue(viewport, field, value) {
  const limits = VIEWPORT_LAYOUT_LIMITS[viewport] || VIEWPORT_LAYOUT_LIMITS.desktop;
  const [min, max] = limits[field] || VIEWPORT_LAYOUT_LIMITS.desktop[field];
  const fallback = VIEWPORT_LAYOUT_DEFAULTS[viewport]?.[field] ?? VIEWPORT_LAYOUT_DEFAULTS.desktop[field];
  const n = finite(value);
  if (n == null) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Slider values. Unsaved fields fall back to the preview defaults. */
export function viewportSlot(config, viewport) {
  const key = viewport === 'mobile' ? 'mobile' : 'desktop';
  const saved = config?.viewportLayout?.[key] || {};
  const defaults = VIEWPORT_LAYOUT_DEFAULTS[key];
  const contentWidth = finite(saved.contentWidth);
  const mediaMaxHeight = finite(saved.mediaMaxHeight);
  return {
    viewport: key,
    contentWidth: contentWidth > 0 ? contentWidth : defaults.contentWidth,
    mediaMaxHeight: mediaMaxHeight > 0 ? mediaMaxHeight : defaults.mediaMaxHeight,
    contentWidthSaved: contentWidth > 0,
    mediaMaxHeightSaved: mediaMaxHeight > 0,
  };
}

export function setViewportLayoutField(config, viewport, field, value) {
  const key = viewport === 'mobile' ? 'mobile' : 'desktop';
  const nextValue = clampLayoutValue(key, field, value);
  const current = config?.viewportLayout || {};
  const slot = { ...(current[key] || {}) };
  if (slot[field] === nextValue) return config;
  slot[field] = nextValue;
  return {
    ...config,
    viewportLayout: { ...current, [key]: slot },
  };
}

/**
 * Sizes to apply on the participant survey. Missing fields stay on the
 * historical hardcoded layout so untouched surveys do not change.
 */
export function resolvePublishedFrame(config, viewportWidth) {
  const viewport = viewportWidth > 0 && viewportWidth < MOBILE_WIDTH ? 'mobile' : 'desktop';
  const saved = config?.viewportLayout?.[viewport];
  if (!saved) return { viewport, contentWidth: null, mediaMaxHeight: null };
  const contentWidth = finite(saved.contentWidth);
  const mediaMaxHeight = finite(saved.mediaMaxHeight);
  return {
    viewport,
    contentWidth: contentWidth > 0 ? contentWidth : null,
    mediaMaxHeight: mediaMaxHeight > 0 ? mediaMaxHeight : null,
  };
}

export function applyContentWidthToModel(model, contentWidth) {
  if (!model || !(finite(contentWidth) > 0)) return;
  model.widthMode = 'static';
  model.width = `${Math.round(contentWidth)}px`;
}

export function updateQuestionText(config, questionName, field, value) {
  let changed = false;
  const pages = (config?.pages || []).map((page) => ({
    ...page,
    elements: (page.elements || []).map((element) => {
      if (!element || element.name !== questionName || element[field] === value) return element;
      changed = true;
      return { ...element, [field]: value };
    }),
  }));
  if (!changed) return config;
  return { ...config, pages };
}

export function updatePageText(config, pageName, field, value) {
  let changed = false;
  const pages = (config?.pages || []).map((page) => {
    if (!page || page.name !== pageName || page[field] === value) return page;
    changed = true;
    return { ...page, [field]: value };
  });
  if (!changed) return config;
  return { ...config, pages };
}

export function moveQuestion(config, questionName, direction) {
  const pages = config?.pages || [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const elements = pages[pageIndex].elements || [];
    const index = elements.findIndex((element) => element?.name === questionName);
    if (index < 0) continue;
    const target = index + direction;
    if (target < 0 || target >= elements.length) return config;
    const nextElements = elements.slice();
    const [item] = nextElements.splice(index, 1);
    nextElements.splice(target, 0, item);
    const nextPages = pages.slice();
    nextPages[pageIndex] = { ...pages[pageIndex], elements: nextElements };
    return { ...config, pages: nextPages };
  }
  return config;
}

export function movePage(config, pageName, direction) {
  const pages = config?.pages || [];
  const index = pages.findIndex((page) => page?.name === pageName);
  if (index < 0) return config;
  const target = index + direction;
  if (target < 0 || target >= pages.length) return config;
  const nextPages = pages.slice();
  const [item] = nextPages.splice(index, 1);
  nextPages.splice(target, 0, item);
  return { ...config, pages: nextPages };
}

/** Drop text and viewport sizes so typing or resizing does not redraw the survey. */
export function configForPreviewRefresh(config) {
  if (!config || typeof config !== 'object') return config || null;
  const rest = { ...config };
  delete rest.viewportLayout;
  delete rest.title;
  delete rest.description;
  if (!Array.isArray(rest.pages)) return rest;
  rest.pages = rest.pages.map((page) => {
    if (!page || typeof page !== 'object') return page;
    const nextPage = { ...page };
    delete nextPage.title;
    delete nextPage.description;
    if (Array.isArray(nextPage.elements)) {
      nextPage.elements = nextPage.elements.map((element) => {
        if (!element || typeof element !== 'object') return element;
        const nextElement = { ...element };
        delete nextElement.title;
        delete nextElement.description;
        return nextElement;
      });
    }
    return nextPage;
  });
  return rest;
}
