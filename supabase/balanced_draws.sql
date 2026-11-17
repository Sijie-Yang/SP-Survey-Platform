-- Balanced sampling ("Balanced" in a question's Sampling Mode).
-- Run once in the Supabase SQL editor; safe to run again.
--
-- A survey with a balanced question gives every new participant a number: the
-- smallest one that nobody has finished and nobody started in the last 30 minutes.
-- The browser turns the number into that participant's images (src/lib/balancedDraw.js),
-- so after any run of participants every image has been shown equally often.
-- A number whose participant left without finishing is handed out again after
-- 30 minutes, so gaps fill themselves.
--
-- Without this file the survey still works: the browser picks a number at random,
-- which is plain random sampling (what "Balanced" did before this file existed).
-- Surveys without a balanced question never call these functions.

CREATE TABLE IF NOT EXISTS public.balance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS balance_claims_project_n
  ON public.balance_claims (project_id, n);

-- No policies: rows are read and written only through the functions below.
ALTER TABLE public.balance_claims ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_balance_number(p_project_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
  v_id UUID;
BEGIN
  IF p_project_id IS NULL OR length(p_project_id) > 256
    OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id::TEXT = p_project_id) THEN
    RAISE EXCEPTION 'unknown project';
  END IF;

  -- One at a time per project, so two people who open the link together get different numbers.
  PERFORM pg_advisory_xact_lock(hashtextextended('balance/' || p_project_id, 0));

  -- Starts that were abandoned long ago are no longer needed.
  DELETE FROM public.balance_claims
  WHERE project_id = p_project_id
    AND completed_at IS NULL
    AND claimed_at < now() - INTERVAL '1 day';

  WITH used AS (
    SELECT DISTINCT c.n
    FROM public.balance_claims c
    WHERE c.project_id = p_project_id
      AND (c.completed_at IS NOT NULL OR c.claimed_at > now() - INTERVAL '30 minutes')
  )
  SELECT g INTO v_n
  FROM generate_series(0, (SELECT COUNT(*)::INTEGER FROM used)) AS g
  WHERE NOT EXISTS (SELECT 1 FROM used u WHERE u.n = g)
  ORDER BY g
  LIMIT 1;

  INSERT INTO public.balance_claims (project_id, n)
  VALUES (p_project_id, v_n)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('n', v_n, 'claim_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_balance_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_balance_number(TEXT) TO anon, authenticated;

-- The participant finished: the number is never handed out again.
CREATE OR REPLACE FUNCTION public.complete_balance_claim(p_claim_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.balance_claims
  SET completed_at = COALESCE(completed_at, now())
  WHERE id = p_claim_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_balance_claim(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_balance_claim(UUID) TO anon, authenticated;

-- When a response is stored on the platform, mark its number as finished here in the
-- database, so it does not depend on the browser making a second call. Whatever the
-- response contains, this must never stop it from being saved: every error is swallowed.
CREATE OR REPLACE FUNCTION public.balance_claim_on_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE public.balance_claims
    SET completed_at = COALESCE(completed_at, now())
    WHERE id = (NEW.survey_metadata::JSONB->'balanced_draw'->>'claim_id')::UUID
      AND project_id = NEW.project_id::TEXT;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS balance_claim_on_response ON public.survey_responses;
CREATE TRIGGER balance_claim_on_response
  AFTER INSERT ON public.survey_responses
  FOR EACH ROW
  WHEN (NEW.survey_metadata IS NOT NULL)
  EXECUTE FUNCTION public.balance_claim_on_response();
