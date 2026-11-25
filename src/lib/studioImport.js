/**
 * Studio import: a prepared SP-Scheme upload (spSchemeImport.js) becomes a
 * project. All or nothing: the page's images go to the library first, then
 * the config and the media list are saved in ONE write. If anything fails,
 * the uploaded images are removed again, a project created for this import
 * is deleted, and nothing is saved.
 */

import { finalizeSpSchemeImport, spSchemeMediaPlan, summarizeSpSchemeImport } from './spSchemeImport';
import { uploadPlannedMedia } from './spSchemeMediaImport';
import { deleteImagesFromR2, uploadImageToR2 } from './r2';
import { createStudioProject, loadStudioProject, removeStudioProject, saveStudioProject } from './studioData';
import { importedProjectName, projectConfig } from './studioProject';

export class StudioImportError extends Error {
  /**
   * @param {'invalid'|'create'|'signin'|'media'|'save'} code
   * @param {string} message
   * @param {object} [extra] e.g. { failures: [{ name, error }] }
   */
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'StudioImportError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * @param {object} args
 * @param {{ upload, report, hosts?, allowed? }} args.prepared prepareSpSchemeUpload result (report revalidated with the chosen hosts)
 * @param {object|null} args.project the project whose page is replaced; null creates a new one
 * @param {string|null} args.userId owner id for media keys (`${userId}/${projectId}/…`)
 * @param {string} args.fallbackName name for a new project when the page has no title
 * @param {(p: { done: number, total: number }) => void} [args.onProgress] image upload progress
 * @returns {Promise<{ projectId: string, config: object, created: boolean }>}
 */
export async function importIntoStudio({ prepared, project = null, userId = null, fallbackName = 'New study', onProgress = () => {} }) {
  const { upload, report } = prepared || {};
  if (!report?.ok || !upload) throw new StudioImportError('invalid', 'This upload cannot be imported.');
  const plan = spSchemeMediaPlan(upload);
  if (plan && !userId) throw new StudioImportError('signin', 'Sign in to upload the images.');

  let target = project;
  let created = false;
  if (!target) {
    const result = await createStudioProject(importedProjectName(summarizeSpSchemeImport(prepared), fallbackName));
    if (!result.success) throw new StudioImportError('create', result.error);
    created = true;
    target = (await loadStudioProject(result.project.id)) || { ...result.project, _surveyConfig: result.surveyConfig || {} };
  }

  const uploadedKeys = [];
  try {
    let media = target;
    if (plan) {
      const result = await uploadPlannedMedia({
        plan,
        project: target,
        userId,
        upload: async (file, key) => {
          const res = await uploadImageToR2(file, key);
          if (res?.success) uploadedKeys.push(res.key || key);
          return res;
        },
        // Kept in memory: the media list is saved once, together with the config.
        onProjectUpdate: async () => {},
        onProgress,
      });
      if (result.failures.length) {
        throw new StudioImportError('media', result.failures[0].error, { failures: result.failures });
      }
      media = result.project;
    }
    const config = finalizeSpSchemeImport(report, upload, projectConfig(target));
    const saved = await saveStudioProject({
      ...target,
      preloadedImages: media.preloadedImages || [],
      preloadedAt: media.preloadedAt || null,
      preloadedSource: media.preloadedSource || null,
    }, config);
    if (!saved.success) throw new StudioImportError('save', saved.error);
    return { projectId: target.id, config, created };
  } catch (err) {
    if (uploadedKeys.length) {
      await deleteImagesFromR2(uploadedKeys, { allowedPrefix: `${userId}/${target.id}/` }).catch(() => null);
    }
    if (created) await removeStudioProject(target.id).catch(() => null);
    throw err;
  }
}
