-- Incremental: replace gen_random_bytes(8) in save_project_draft.
-- Inbox SQL does not update this function. Safe to re-run.
-- Keeps auth, FOR UPDATE, expectedDraftUpdatedAt conflict, dual-write,
-- audit, and GRANT EXECUTE.

CREATE OR REPLACE FUNCTION public.save_project_draft(
  p_project_id TEXT,
  p_survey_config JSONB,
  p_expected_draft_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_writer JSONB DEFAULT '{}'::jsonb,
  p_client_mutation_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_revision TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT draft_updated_at INTO v_current
  FROM public.projects
  WHERE id = p_project_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  IF p_expected_draft_updated_at IS NOT NULL
     AND v_current IS NOT NULL
     AND p_expected_draft_updated_at <> v_current THEN
    RAISE EXCEPTION 'conflict: draft changed'
      USING ERRCODE = '40001';
  END IF;

  v_revision := coalesce(
    p_client_mutation_id,
    'rev_' || left(replace(gen_random_uuid()::text, '-', ''), 16)
  );

  UPDATE public.projects SET
    survey_config = p_survey_config,
    survey_config_draft = p_survey_config,
    draft_updated_at = v_now,
    updated_at = v_now,
    revision_id = v_revision,
    last_writer = COALESCE(p_writer, '{}'::jsonb) || jsonb_build_object('at', v_now)
  WHERE id = p_project_id;

  PERFORM public.write_audit_event(
    'project.save',
    p_project_id,
    'project',
    p_project_id,
    jsonb_build_object('revisionId', v_revision, 'writer', p_writer)
  );

  RETURN jsonb_build_object(
    'draftUpdatedAt', v_now,
    'revisionId', v_revision
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_project_draft(TEXT, JSONB, TIMESTAMPTZ, JSONB, TEXT) TO authenticated;
