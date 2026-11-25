/**
 * Deterministic check before Studio publishes a project. Problems come back
 * as codes; the page words them.
 *
 *   empty         the project has no page and no questions
 *   folder-empty  the page reads an image folder that holds no files ({ folder })
 *   config        the survey config is invalid ({ message })
 *   media         a question cannot draw enough images ({ question })
 */

import { runSurveyPreflight } from './surveyPreflight';
import { configHasQuestions, missingPageFolders, projectConfig } from './studioProject';

export async function studioPublishProblems(project, config = projectConfig(project)) {
  const problems = [];
  const hasPage = Boolean(config?.spSite?.html);
  if (!hasPage && !configHasQuestions(config)) return [{ code: 'empty' }];
  missingPageFolders(project, config).forEach((folder) => problems.push({ code: 'folder-empty', folder }));
  // A page draws its own images from its folders; the question check is for classic surveys.
  if (!hasPage) {
    const report = await runSurveyPreflight(config, {
      preloadedImages: project?.preloadedImages || [],
      imageDatasetConfig: project?.imageDatasetConfig || {},
    }, { participants: 1 });
    report.validation.errors.forEach((error) => problems.push({ code: 'config', message: `${error.path ? `${error.path}: ` : ''}${error.message}` }));
    report.questions.filter((q) => q.missing).forEach((q) => problems.push({ code: 'media', question: typeof q.title === 'string' && q.title ? q.title : q.name }));
  }
  return problems;
}
