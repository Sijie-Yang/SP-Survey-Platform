-- Experiment design support (run once in the Supabase SQL editor; safe to re-run).
--
-- 1. get_pair_stats: per-media exposure counts computed from the stored responses,
--    so the "Balanced" and "Adaptive" sampling modes see real numbers. Before this,
--    the function read a survey_pair_stats table that nothing ever wrote, so both
--    modes behaved like plain random sampling.
-- 2. design_claims + claim_design_version: hands each new participant the design
--    version that has been done the fewest times (completed + started in the last
--    2 hours), under a lock so two people opening the link together still get
--    different versions.
--
-- The survey keeps working without this file: exposure balancing falls back to
-- random sampling, and design versions are picked at random in the browser
-- (recorded as claim "local" so Results can tell).

CREATE OR REPLACE FUNCTION public.get_pair_stats(p_project_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH answered AS (
    SELECT q.value AS qv
    FROM public.survey_responses r
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(r.responses) = 'object' THEN r.responses ELSE '{}'::jsonb END) q
    WHERE r.project_id = p_project_id
      AND COALESCE((r.survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
      AND jsonb_typeof(q.value) = 'object'
  ),
  units AS (
    SELECT t.value AS u
    FROM answered a
    CROSS JOIN LATERAL jsonb_array_elements(a.qv->'trials') t
    WHERE jsonb_typeof(a.qv->'trials') = 'array'
    UNION ALL
    SELECT a.qv FROM answered a
    WHERE jsonb_typeof(a.qv->'trials') IS DISTINCT FROM 'array'
  ),
  shown AS (
    SELECT jsonb_array_elements_text(u->'shown_media_ids') AS image_key
    FROM units
    WHERE jsonb_typeof(u->'shown_media_ids') = 'array'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('image_key', image_key, 'exposures', n)), '[]'::jsonb)
  FROM (SELECT image_key, COUNT(*)::INTEGER AS n FROM shown WHERE image_key <> '' GROUP BY 1) s;
$$;

GRANT EXECUTE ON FUNCTION public.get_pair_stats(TEXT) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.design_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  design_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_claims_lookup
  ON public.design_claims (project_id, design_id, claimed_at);

-- No policies: rows are written and read only through the function below.
ALTER TABLE public.design_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_design_version(p_project_id TEXT, p_design_id TEXT, p_versions INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version INTEGER;
  v_id UUID;
BEGIN
  IF p_versions IS NULL OR p_versions < 1 OR p_versions > 100000 THEN
    RAISE EXCEPTION 'p_versions must be between 1 and 100000';
  END IF;
  IF p_design_id IS NULL OR length(p_design_id) > 80 THEN
    RAISE EXCEPTION 'invalid design id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id::TEXT = p_project_id) THEN
    RAISE EXCEPTION 'unknown project';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_project_id || ':' || p_design_id));

  WITH done AS (
    SELECT (r.survey_metadata->'experiment_design'->>'version')::INTEGER AS v,
           r.survey_metadata->'experiment_design'->>'claim_id' AS claim_id
    FROM public.survey_responses r
    WHERE r.project_id = p_project_id
      AND r.survey_metadata->'experiment_design'->>'id' = p_design_id
      AND COALESCE((r.survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
  ),
  done_n AS (
    SELECT v, COUNT(*) AS n FROM done GROUP BY v
  ),
  active_n AS (
    SELECT c.version AS v, COUNT(*) AS n
    FROM public.design_claims c
    WHERE c.project_id = p_project_id
      AND c.design_id = p_design_id
      AND c.claimed_at > now() - INTERVAL '2 hours'
      AND NOT EXISTS (SELECT 1 FROM done d WHERE d.claim_id = c.id::TEXT)
    GROUP BY c.version
  )
  SELECT g.v INTO v_version
  FROM generate_series(0, p_versions - 1) AS g(v)
  LEFT JOIN done_n d ON d.v = g.v
  LEFT JOIN active_n a ON a.v = g.v
  ORDER BY COALESCE(d.n, 0) + COALESCE(a.n, 0), g.v
  LIMIT 1;

  INSERT INTO public.design_claims (project_id, design_id, version)
  VALUES (p_project_id, p_design_id, v_version)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('version', v_version, 'claim_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_design_version(TEXT, TEXT, INTEGER) TO anon, authenticated;
