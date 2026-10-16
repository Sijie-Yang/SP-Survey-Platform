-- Homepage "growth" section: public aggregate numbers and a privacy-safe
-- visit counter. Additive and idempotent; run once in the Supabase SQL editor.
--
-- Nothing personal is stored or returned: visits are one counter row per UTC
-- day (no IP, no user agent, no cookie id), and the stats function returns
-- only totals and per-month counts.

CREATE TABLE IF NOT EXISTS public.site_daily_visits (
  day      DATE PRIMARY KEY,
  visits   INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0
);

-- No policies: only the SECURITY DEFINER functions below touch the table.
ALTER TABLE public.site_daily_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_daily_visits FROM anon, authenticated;

-- Called by the browser once per tab session. p_new_visitor is true the first
-- time this browser visits on a given UTC day (remembered in localStorage).
CREATE OR REPLACE FUNCTION public.record_site_visit(p_new_visitor BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.site_daily_visits AS v (day, visits, visitors)
  VALUES ((now() AT TIME ZONE 'utc')::date, 1, CASE WHEN p_new_visitor THEN 1 ELSE 0 END)
  ON CONFLICT (day) DO UPDATE
    SET visits = v.visits + 1,
        visitors = v.visitors + CASE WHEN p_new_visitor THEN 1 ELSE 0 END;
$$;

REVOKE ALL ON FUNCTION public.record_site_visit(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_site_visit(BOOLEAN) TO anon, authenticated;

-- Totals plus the last 12 months, oldest first:
-- { users, projects, responses, visits, visitors, visits_30d, visitors_30d,
--   since, months: [{ month: 'YYYY-MM', users, projects, responses, visits, visitors }] }
-- `users`/`projects`/`responses` in months are new that month; the page
-- accumulates them. Researcher test runs are not counted as responses.
CREATE OR REPLACE FUNCTION public.get_site_growth_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE := (date_trunc('month', now() AT TIME ZONE 'utc') - INTERVAL '11 months')::date;
  v_result JSONB;
BEGIN
  WITH months AS (
    SELECT generate_series(v_start, (now() AT TIME ZONE 'utc')::date, INTERVAL '1 month')::date AS m
  ),
  u AS (
    SELECT date_trunc('month', created_at AT TIME ZONE 'utc')::date AS m, COUNT(*) AS n
    FROM auth.users
    WHERE created_at >= v_start
    GROUP BY 1
  ),
  p AS (
    SELECT date_trunc('month', created_at AT TIME ZONE 'utc')::date AS m, COUNT(*) AS n
    FROM public.projects
    WHERE created_at >= v_start
    GROUP BY 1
  ),
  r AS (
    SELECT date_trunc('month', created_at AT TIME ZONE 'utc')::date AS m, COUNT(*) AS n
    FROM public.survey_responses
    WHERE created_at >= v_start
      AND COALESCE((survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
    GROUP BY 1
  ),
  v AS (
    SELECT date_trunc('month', day)::date AS m, SUM(visits) AS visits, SUM(visitors) AS visitors
    FROM public.site_daily_visits
    WHERE day >= v_start
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'users', (SELECT COUNT(*) FROM auth.users),
    'users_before', (SELECT COUNT(*) FROM auth.users WHERE created_at < v_start),
    'projects', (SELECT COUNT(*) FROM public.projects),
    'projects_before', (SELECT COUNT(*) FROM public.projects WHERE created_at < v_start),
    'responses', (
      SELECT COUNT(*) FROM public.survey_responses
      WHERE COALESCE((survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
    ),
    'responses_before', (
      SELECT COUNT(*) FROM public.survey_responses
      WHERE created_at < v_start
        AND COALESCE((survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
    ),
    'visits', (SELECT COALESCE(SUM(visits), 0) FROM public.site_daily_visits),
    'visitors', (SELECT COALESCE(SUM(visitors), 0) FROM public.site_daily_visits),
    'visits_30d', (
      SELECT COALESCE(SUM(visits), 0) FROM public.site_daily_visits
      WHERE day > (now() AT TIME ZONE 'utc')::date - 30
    ),
    'visitors_30d', (
      SELECT COALESCE(SUM(visitors), 0) FROM public.site_daily_visits
      WHERE day > (now() AT TIME ZONE 'utc')::date - 30
    ),
    'visits_since', (SELECT MIN(day) FROM public.site_daily_visits),
    'months', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', to_char(months.m, 'YYYY-MM'),
        'users', COALESCE(u.n, 0),
        'projects', COALESCE(p.n, 0),
        'responses', COALESCE(r.n, 0),
        'visits', COALESCE(v.visits, 0),
        'visitors', COALESCE(v.visitors, 0)
      ) ORDER BY months.m), '[]'::jsonb)
      FROM months
      LEFT JOIN u ON u.m = months.m
      LEFT JOIN p ON p.m = months.m
      LEFT JOIN r ON r.m = months.m
      LEFT JOIN v ON v.m = months.m
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_site_growth_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_growth_stats() TO anon, authenticated;
