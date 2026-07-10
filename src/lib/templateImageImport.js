/** Template → project image import helpers (R2 copy + progress tracking). */

import { listImagesFromR2 } from './r2';
import { inferMediaType, compareMediaNames } from './mediaUtils';

export function getTemplateImportHistory(project) {
  return project?.imageDatasetConfig?.templateImportHistory || {};
}

export function mergeTemplateImportHistory(project, templateId, entry) {
  const prev = getTemplateImportHistory(project);
  return {
    ...project.imageDatasetConfig,
    templateImportHistory: {
      ...prev,
      [templateId]: {
        ...prev[templateId],
        ...entry,
        templateId,
      },
    },
  };
}

/**
 * Compare template R2 folder vs project folder by filename.
 * Used to skip already-copied files when importing/resuming ONE template.
 * Do NOT treat filename overlap as proof that other templates were imported —
 * many templates share the same streetscape filenames.
 */
export async function computeTemplateImportProgress(templateId, userId, projectId) {
  if (!templateId || !projectId) {
    return {
      totalInTemplate: 0,
      importedCount: 0,
      remaining: 0,
      isComplete: false,
      hasStarted: false,
      templateImages: [],
      error: null,
    };
  }
  const templatePrefix = `templates/${templateId}/`;
  const projectPrefix = `${userId}/${projectId}/`;

  const [listed, existing] = await Promise.all([
    listImagesFromR2(templatePrefix),
    listImagesFromR2(projectPrefix),
  ]);

  if (!listed.success) {
    return {
      totalInTemplate: 0,
      importedCount: 0,
      remaining: 0,
      isComplete: false,
      hasStarted: false,
      templateImages: [],
      error: listed.error || 'Failed to list template images',
    };
  }

  const existingNames = new Set((existing.images || []).map((i) => i.name));
  const templateImages = listed.images || [];
  const importedCount = templateImages.filter((img) => existingNames.has(img.name)).length;
  const totalInTemplate = templateImages.length;
  const remaining = Math.max(0, totalInTemplate - importedCount);
  const hasStarted = importedCount > 0;

  return {
    totalInTemplate,
    importedCount,
    remaining,
    // Empty template folder is not "complete import" — nothing to copy.
    isComplete: totalInTemplate > 0 && remaining === 0,
    hasStarted,
    templateImages,
    existingNames,
    error: null,
  };
}

export function buildTemplateCopyTodo(templateImages, existingNames, projectPrefix) {
  return templateImages
    .filter((img) => !existingNames.has(img.name))
    .map((img) => ({ from: img.key, to: `${projectPrefix}${img.name}` }));
}

export function mergeCopiedIntoProjectImages(existingImages, copiedImages, r2PublicUrl) {
  const byName = new Map();
  (existingImages || []).forEach((img) => {
    byName.set(img.name, {
      url: img.url || (r2PublicUrl && img.key ? `${r2PublicUrl}/${img.key}` : ''),
      name: img.name,
      key: img.key,
      type: img.type || inferMediaType(img.name),
    });
  });
  copiedImages.forEach((c) => {
    const name = c.to.split('/').pop();
    byName.set(name, {
      url: c.url || (r2PublicUrl ? `${r2PublicUrl}/${c.to}` : ''),
      name,
      key: c.to,
      type: inferMediaType(name),
    });
  });
  return [...byName.values()].sort((a, b) => compareMediaNames(a.name, b.name));
}

/**
 * Label for the template picker.
 * @param {object|null} progress - live R2 filename overlap
 * @param {object|null} historyEntry - explicit import history for this template
 */
export function formatTemplateImportStatus(progress, historyEntry = null) {
  const catalog = progress?.totalInTemplate;
  if (historyEntry?.lastImportAt) {
    if (progress?.isComplete) {
      return `Imported (${progress.importedCount}/${progress.totalInTemplate})`;
    }
    if (progress?.hasStarted) {
      return `${progress.importedCount}/${progress.totalInTemplate} imported · ${progress.remaining} left`;
    }
    return historyEntry.isComplete
      ? `Imported (${historyEntry.importedCount}/${historyEntry.totalInTemplate})`
      : `${historyEntry.importedCount || 0}/${historyEntry.totalInTemplate || catalog || '?'} imported`;
  }
  if (catalog === 0) return 'No images in template folder';
  if (typeof catalog === 'number') return `${catalog} in catalog`;
  return '';
}

/** Primary CTA label for the import button. */
export function formatTemplateImportButtonLabel(progress, historyEntry = null, { loading = false } = {}) {
  if (loading) return 'Importing…';
  const hasHistory = Boolean(historyEntry?.lastImportAt);
  // Only history proves this template was imported. Shared filenames across
  // templates must not flip a fresh pick into Resume / Re-check.
  if (hasHistory && progress?.remaining > 0) {
    return `Resume import (${progress.remaining} remaining)`;
  }
  if (hasHistory && (progress?.isComplete || historyEntry?.isComplete)) {
    return 'Re-check template (all copied)';
  }
  return 'Import from selected template';
}
