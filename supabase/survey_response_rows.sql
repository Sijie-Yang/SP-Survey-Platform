-- Results loading: response rows without the per-row copy of the recorded survey contract.
-- Every submission stores survey_metadata.survey_response_contract (question settings plus media URL lists),
-- which is identical for all rows of a revision and dominates row size. This returns each distinct contract
-- once, keyed by md5 of its jsonb text, and the rows (column order and values as `select=*`) without it.
-- SECURITY INVOKER: owners still read through survey_responses RLS; the admin Worker uses service_role.
-- Safe to re-run.

CREATE INDEX IF NOT EXISTS idx_survey_responses_project_created
  ON public.survey_responses (project_id, created_at DESC NULLS LAST, id DESC);

CREATE OR REPLACE FUNCTION public.survey_response_rows(
  p_project_id TEXT,
  p_ids TEXT[],
  p_known_contracts TEXT[] DEFAULT '{}'
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  r public.survey_responses%ROWTYPE;
  v_contract JSONB;
  v_key TEXT;
  v_rows JSON[] := '{}';
  v_refs TEXT[] := '{}';
  v_contracts JSONB := '{}'::jsonb;
BEGIN
  IF p_project_id IS NULL OR p_ids IS NULL OR cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'Invalid response page';
  END IF;
  FOR r IN
    SELECT * FROM public.survey_responses s
    WHERE s.project_id = p_project_id AND s.id::text = ANY(p_ids)
  LOOP
    v_contract := r.survey_metadata -> 'survey_response_contract';
    v_key := NULL;
    IF jsonb_typeof(v_contract) = 'object' THEN
      v_key := md5(v_contract::text);
      r.survey_metadata := r.survey_metadata - 'survey_response_contract';
      IF NOT (v_key = ANY(COALESCE(p_known_contracts, '{}'))) AND NOT (v_contracts ? v_key) THEN
        v_contracts := v_contracts || jsonb_build_object(v_key, v_contract);
      END IF;
    END IF;
    v_rows := array_append(v_rows, to_json(r));
    v_refs := array_append(v_refs, v_key);
  END LOOP;
  RETURN json_build_object('rows', array_to_json(v_rows), 'refs', to_json(v_refs), 'contracts', v_contracts);
END;
$$;

REVOKE ALL ON FUNCTION public.survey_response_rows(TEXT, TEXT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.survey_response_rows(TEXT, TEXT[], TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.survey_response_rows(TEXT, TEXT[], TEXT[]) TO authenticated, service_role;
