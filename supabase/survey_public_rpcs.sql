-- Public survey RPCs referenced by the SPA.
-- Additive and idempotent. Participant links always load the latest project
-- (draft/live), not a published snapshot. "Publish" in the product means
-- Live Surveys homepage listing, not gating the share URL.
-- DROP first: CREATE OR REPLACE cannot change a function's return type.

DROP FUNCTION IF EXISTS public.get_survey_project(TEXT);
DROP FUNCTION IF EXISTS public.count_responses(TEXT);
DROP FUNCTION IF EXISTS public.get_pair_stats(TEXT);

CREATE OR REPLACE FUNCTION public.get_survey_project(p_id TEXT)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  description TEXT,
  survey_config JSONB,
  image_dataset_config JSONB,
  preloaded_images JSONB,
  preloaded_at TIMESTAMPTZ,
  preloaded_source TEXT,
  template_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.description,
    COALESCE(p.survey_config_draft, p.survey_config) AS survey_config,
    -- Strip credential-bearing keys from public image dataset config
    (
      COALESCE(p.image_dataset_config, '{}'::jsonb)
      - 'huggingFaceToken'
      - 'falApiKey'
      - 'falKey'
      - 'supabaseKey'
      - 'supabaseAnonKey'
      - 'openaiApiKey'
      - 'apiKey'
    ) AS image_dataset_config,
    p.preloaded_images,
    p.preloaded_at,
    p.preloaded_source,
    p.template_id
  FROM public.projects p
  WHERE p.id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_survey_project(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_responses(p_project_id TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.survey_responses
  WHERE project_id = p_project_id;
$$;

GRANT EXECUTE ON FUNCTION public.count_responses(TEXT) TO anon, authenticated;

-- Pairwise / TrueSkill helper used by adaptive media (minimal stub if table exists)
CREATE OR REPLACE FUNCTION public.get_pair_stats(p_project_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Return empty stats if the detailed pair table is not present.
  IF to_regclass('public.survey_pair_stats') IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(s))
      FROM public.survey_pair_stats s
      WHERE s.project_id = p_project_id
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pair_stats(TEXT) TO anon, authenticated;
