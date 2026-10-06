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
  v_rows JSON;
  v_refs JSON;
  v_contracts JSONB;
BEGIN
  IF p_project_id IS NULL OR p_ids IS NULL OR cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'Invalid response page';
  END IF;
  -- One pass over the requested ids. The previous loop copied the growing JSON
  -- array once per row, which timed out once map polygons made each row large.
  WITH picked AS (
    SELECT
      s AS original,
      CASE
        WHEN jsonb_typeof(s.survey_metadata -> 'survey_response_contract') = 'object'
        THEN md5((s.survey_metadata -> 'survey_response_contract')::text)
      END AS contract_key,
      CASE
        WHEN jsonb_typeof(s.survey_metadata -> 'survey_response_contract') = 'object'
        THEN s.survey_metadata -> 'survey_response_contract'
      END AS contract_json
    FROM public.survey_responses s
    WHERE s.project_id = p_project_id
      AND s.id::text = ANY (p_ids)
  ),
  shaped AS (
    SELECT
      jsonb_populate_record(
        picked.original,
        jsonb_build_object(
          'survey_metadata',
          CASE
            WHEN picked.contract_key IS NOT NULL
            THEN (picked.original).survey_metadata - 'survey_response_contract'
            ELSE (picked.original).survey_metadata
          END
        )
      ) AS row_out,
      picked.contract_key,
      picked.contract_json,
      row_number() OVER () AS ord
    FROM picked
  )
  SELECT
    coalesce(json_agg(to_json(shaped.row_out) ORDER BY shaped.ord), '[]'::json),
    coalesce(json_agg(shaped.contract_key ORDER BY shaped.ord), '[]'::json),
    coalesce((
      SELECT jsonb_object_agg(c.contract_key, c.contract_json)
      FROM (
        SELECT DISTINCT ON (contract_key) contract_key, contract_json
        FROM shaped
        WHERE contract_key IS NOT NULL
          AND NOT (contract_key = ANY (COALESCE(p_known_contracts, '{}')))
        ORDER BY contract_key
      ) c
    ), '{}'::jsonb)
  INTO v_rows, v_refs, v_contracts
  FROM shaped;

  RETURN json_build_object('rows', v_rows, 'refs', v_refs, 'contracts', v_contracts);
END;
$$;

REVOKE ALL ON FUNCTION public.survey_response_rows(TEXT, TEXT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.survey_response_rows(TEXT, TEXT[], TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.survey_response_rows(TEXT, TEXT[], TEXT[]) TO authenticated, service_role;
