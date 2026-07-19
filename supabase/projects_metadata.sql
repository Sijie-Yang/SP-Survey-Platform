-- Additive: project card metadata for Admin Edit + MCP survey_update_project.
-- Safe to re-run. Also included in agent_mcp_platform.sql.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.projects.metadata IS
  'Researcher project card fields: author, year, category, tags[], website, huggingfaceDataset';
