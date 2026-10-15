/**
 * Saved AI analyses are kept in the project's metadata (resultsAiAnalyses,
 * keyed by question name), so they belong to the project, not to one survey
 * revision, and every collaborator and export sees the same code.
 */
import { supabase } from './supabase';

export async function saveQuestionAnalysis(projectId, questionName, entry) {
  if (!supabase || !projectId || !questionName) throw new Error('Sign in to save the analysis.');
  const { data, error } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle();
  if (error) throw error;
  const metadata = data?.metadata && typeof data.metadata === 'object' ? { ...data.metadata } : {};
  const analyses = metadata.resultsAiAnalyses && typeof metadata.resultsAiAnalyses === 'object' ? { ...metadata.resultsAiAnalyses } : {};
  if (entry) analyses[questionName] = entry;
  else delete analyses[questionName];
  metadata.resultsAiAnalyses = analyses;
  const { error: updateError } = await supabase.from('projects').update({ metadata }).eq('id', projectId);
  if (updateError) throw updateError;
  return metadata;
}
