-- Owner read/delete for survey_responses (platform mode).
-- Safe to re-run. MCP uses service-role after ownership check; this covers JWT/Admin.

ALTER TABLE public.survey_responses
  ADD COLUMN IF NOT EXISTS project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_survey_responses_project_id
  ON public.survey_responses (project_id);

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_responses_owner_select" ON public.survey_responses;
CREATE POLICY "survey_responses_owner_select"
  ON public.survey_responses
  FOR SELECT
  TO authenticated
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = survey_responses.project_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "survey_responses_owner_delete" ON public.survey_responses;
CREATE POLICY "survey_responses_owner_delete"
  ON public.survey_responses
  FOR DELETE
  TO authenticated
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = survey_responses.project_id
        AND p.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "survey_responses_owner_select" ON public.survey_responses IS
  'Researchers can read responses for projects they own';
