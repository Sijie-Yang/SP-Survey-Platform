/**
 * Keep the full media + survey context when Admin Dashboard opens
 * builder or preview. A trimmed {id,name,preloadedImages} object drops
 * folder tags and the live questionnaire, so category/set sampling looks empty.
 */
export function toAdminPreviewProject(project, { config } = {}) {
  if (!project) return null;
  return {
    ...project,
    preloadedImages: Array.isArray(project.preloadedImages) ? project.preloadedImages : [],
    imageDatasetConfig: project.imageDatasetConfig || project.image_dataset_config || {},
    config: config ?? project.config ?? project.survey_config_draft ?? project.survey_config ?? {},
  };
}
