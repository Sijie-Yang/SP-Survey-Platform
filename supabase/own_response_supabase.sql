-- Researcher-owned response sink.
-- Stores only the public anon key, project URL, and table name so the
-- participant page can INSERT. The platform does not copy, analyze, or sync
-- those rows and does not accept a service_role key.
-- Apply after research_releases.sql. Safe to re-run.
-- Default table in the researcher's project: sp_survey_responses
-- (the SQL they paste is shown in Share, not created here).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS own_response_supabase JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.projects.own_response_supabase IS
  'Optional participant insert target in the researcher Supabase project: {enabled, url, anonKey, table}. Anon public key only. Default table sp_survey_responses. Never a service_role key. Omitted from templates and landing JSON.';

CREATE OR REPLACE FUNCTION public.sp_survey_jwt_role(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_part TEXT;
  v_json JSONB;
BEGIN
  IF p_token IS NULL THEN
    RETURN NULL;
  END IF;
  v_part := split_part(p_token, '.', 2);
  IF v_part = '' OR split_part(p_token, '.', 3) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_part := replace(replace(v_part, '-', '+'), '_', '/');
    v_part := v_part || repeat('=', (4 - length(v_part) % 4) % 4);
    v_json := convert_from(decode(v_part, 'base64'), 'utf8')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN v_json->>'role';
END;
$$;

REVOKE ALL ON FUNCTION public.sp_survey_jwt_role(TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_participant_response_sink(p_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p.own_response_supabase->>'enabled', '') = 'true'
      AND COALESCE(public.sp_survey_jwt_role(p.own_response_supabase->>'anonKey'), '') = 'service_role'
      THEN jsonb_build_object('enabled', true, 'rejected', 'service_role')
    WHEN COALESCE(p.own_response_supabase->>'enabled', '') = 'true'
      AND COALESCE(p.own_response_supabase->>'url', '') !~ '^https://'
      THEN jsonb_build_object('enabled', true, 'rejected', 'https-only')
    WHEN COALESCE(p.own_response_supabase->>'enabled', '') = 'true'
      AND length(btrim(COALESCE(p.own_response_supabase->>'anonKey', ''))) = 0
      THEN jsonb_build_object('enabled', true, 'rejected', 'invalid')
    WHEN COALESCE(p.own_response_supabase->>'enabled', '') = 'true'
      THEN jsonb_build_object(
        'enabled', true,
        'url', p.own_response_supabase->>'url',
        'anonKey', p.own_response_supabase->>'anonKey',
        'table', COALESCE(NULLIF(btrim(p.own_response_supabase->>'table'), ''), 'sp_survey_responses')
      )
    ELSE jsonb_build_object('enabled', false)
  END
  FROM public.projects p
  WHERE p.id = p_id;
$$;

REVOKE ALL ON FUNCTION public.get_participant_response_sink(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_participant_response_sink(TEXT) TO anon, authenticated;
