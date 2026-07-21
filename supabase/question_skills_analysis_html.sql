-- Optional skill-authored analysis view (sandboxed HTML for Results Analysis).
-- Run in Supabase SQL editor after agent_mcp_platform / question_skills exists.

alter table if exists public.question_skills
  add column if not exists analysis_html text default '';

comment on column public.question_skills.analysis_html is
  'Optional HTML analysis view using SPAnalysis SDK (spanalysis-init / getResponses).';
