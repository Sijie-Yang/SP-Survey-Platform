-- Admin dashboard (平台管理 → 平台增长): growth, conversion, and what the
-- shared free AI model costs. Additive and idempotent; re-run the whole file
-- in the Supabase SQL editor after changes. Needs site_growth_stats.sql,
-- ai_runtime.sql, forum.sql and site_feedback.sql to have been run before.
--
-- 1) public.ai_usage_log: one row per model call, written by the Worker with
--    the service role (worker-lib/agent/usageLog.mjs). No browser access.
-- 2) A one-time backfill from public.ai_runs, so older Assistant runs show
--    up too (cost estimated without cache information, flagged `estimated`).
-- 3) public.get_platform_dashboard(): one JSON for the admin page. Platform
--    admins only. Never used on the homepage.

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Whose API key paid: the user's own, or the admin who shares the free model.
  key_owner_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source            TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'subsidy')),
  feature           TEXT NOT NULL DEFAULT 'assistant',
  project_id        TEXT,
  run_id            UUID,
  provider          TEXT,
  model             TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(14, 6),
  estimated         BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ai_usage_log_created_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_run_idx ON public.ai_usage_log (run_id);

-- No policies: only the Worker (service role) and the function below touch it.
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_log FROM anon, authenticated;

-- Backfill: Assistant runs that have tokens but no usage rows yet. A run used
-- the free model when the user had no key of their own for that provider
-- (best guess for old runs). Price: catalog price for DeepSeek models, all
-- prompt tokens counted as cache misses, so these older costs are an upper
-- bound. Re-running adds nothing twice (run_id check).
INSERT INTO public.ai_usage_log (
  created_at, user_id, key_owner_id, source, feature, project_id, run_id,
  provider, model, prompt_tokens, cache_read_tokens, completion_tokens, cost_usd, estimated
)
SELECT
  COALESCE(r.finished_at, r.started_at, r.created_at),
  r.user_id,
  CASE WHEN c.user_id IS NOT NULL THEN r.user_id
       ELSE (SELECT s.donor_user_id FROM public.platform_assistant_subsidy s WHERE s.id = 1) END,
  CASE WHEN c.user_id IS NOT NULL THEN 'user' ELSE 'subsidy' END,
  CASE WHEN r.assistant_mode = 'spscheme' THEN 'assistant-spscheme'
       WHEN r.assistant_mode = 'review' THEN 'review'
       ELSE 'assistant' END,
  r.project_id,
  r.id,
  r.provider,
  r.model,
  COALESCE(r.prompt_tokens, 0),
  0,
  COALESCE(r.completion_tokens, 0),
  CASE
    WHEN r.provider = 'deepseek' AND r.model IN ('deepseek-flash', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash')
      THEN round((COALESCE(r.prompt_tokens, 0) * 0.3 + COALESCE(r.completion_tokens, 0) * 1.2) / 1e6, 6)
    WHEN r.provider = 'deepseek' AND r.model = 'deepseek-v4-pro'
      THEN round((COALESCE(r.prompt_tokens, 0) * 1.32 + COALESCE(r.completion_tokens, 0) * 3.96) / 1e6, 6)
    ELSE NULL
  END,
  true
FROM public.ai_runs r
LEFT JOIN public.user_ai_provider_credentials c
  ON c.user_id = r.user_id AND c.provider = r.provider
WHERE COALESCE(r.prompt_tokens, 0) + COALESCE(r.completion_tokens, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.ai_usage_log l WHERE l.run_id = r.id);

-- Everything the admin dashboard shows, as one JSON object:
-- { generated_at, totals, recent, funnel, project_kinds, days[30], months[12],
--   before, top_projects[10], ai: { since, all, d30, month, days[30], months[12],
--   features[], models[], free_users[] }, subsidy }
-- "ours" = calls paid with a platform admin's key (the free model given to
-- others, plus the admins' own use). Researcher test runs are not responses.
CREATE OR REPLACE FUNCTION public.get_platform_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today  DATE := (now() AT TIME ZONE 'utc')::date;
  v_d30    DATE := (now() AT TIME ZONE 'utc')::date - 29;
  v_d60    DATE := (now() AT TIME ZONE 'utc')::date - 59;
  v_m12    DATE := (date_trunc('month', now() AT TIME ZONE 'utc') - INTERVAL '11 months')::date;
  v_mon    DATE := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  v_result JSONB;
BEGIN
  IF NOT COALESCE(public.is_platform_admin(), FALSE) THEN
    RAISE EXCEPTION 'platform admins only' USING ERRCODE = '42501';
  END IF;

  WITH
  resp AS (
    SELECT project_id, (created_at AT TIME ZONE 'utc')::date AS d
    FROM public.survey_responses
    WHERE COALESCE((survey_metadata->>'researcher_mode')::BOOLEAN, FALSE) = FALSE
  ),
  usr AS (SELECT id, (created_at AT TIME ZONE 'utc')::date AS d FROM auth.users),
  prj AS (
    SELECT id, user_id, name, (created_at AT TIME ZONE 'utc')::date AS d, updated_at,
      (COALESCE(length(survey_config_draft->'spSite'->>'html'), 0) > 0
        OR COALESCE(length(survey_config_published->'spSite'->>'html'), 0) > 0) AS sp_scheme
    FROM public.projects
  ),
  vis AS (SELECT day AS d, visits, visitors FROM public.site_daily_visits),
  ai AS (
    SELECT l.*, (l.created_at AT TIME ZONE 'utc')::date AS d,
      (l.key_owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = l.key_owner_id)) AS ours,
      COALESCE(l.cost_usd, 0) AS cost
    FROM public.ai_usage_log l
  ),
  resp_by_project AS (
    SELECT project_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE d >= v_d30) AS last30
    FROM resp GROUP BY project_id
  ),
  owner_stats AS (
    SELECT p.user_id,
      bool_or(EXISTS (SELECT 1 FROM public.project_config_versions v WHERE v.project_id = p.id)) AS published,
      COALESCE(SUM(rp.total), 0) AS responses
    FROM prj p
    LEFT JOIN resp_by_project rp ON rp.project_id = p.id
    WHERE p.user_id IS NOT NULL
    GROUP BY p.user_id
  ),
  days AS (SELECT generate_series(v_d30, v_today, INTERVAL '1 day')::date AS d),
  months AS (SELECT generate_series(v_m12, v_today, INTERVAL '1 month')::date AS m)
  SELECT jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'users', (SELECT COUNT(*) FROM usr),
      'projects', (SELECT COUNT(*) FROM prj),
      'responses', (SELECT COUNT(*) FROM resp),
      'visits', (SELECT COALESCE(SUM(visits), 0) FROM vis),
      'visitors', (SELECT COALESCE(SUM(visitors), 0) FROM vis),
      'visits_since', (SELECT MIN(d) FROM vis),
      'forum_threads', (SELECT COUNT(*) FROM public.forum_threads WHERE NOT hidden),
      'forum_posts', (SELECT COUNT(*) FROM public.forum_posts WHERE NOT hidden),
      'feedback', (SELECT COUNT(*) FROM public.site_feedback),
      'feedback_new', (SELECT COUNT(*) FROM public.site_feedback WHERE status = 'new')
    ),
    -- Last 30 days vs the 30 days before.
    'recent', jsonb_build_object(
      'users', (SELECT COUNT(*) FROM usr WHERE d >= v_d30),
      'users_prev', (SELECT COUNT(*) FROM usr WHERE d >= v_d60 AND d < v_d30),
      'projects', (SELECT COUNT(*) FROM prj WHERE d >= v_d30),
      'projects_prev', (SELECT COUNT(*) FROM prj WHERE d >= v_d60 AND d < v_d30),
      'responses', (SELECT COUNT(*) FROM resp WHERE d >= v_d30),
      'responses_prev', (SELECT COUNT(*) FROM resp WHERE d >= v_d60 AND d < v_d30),
      'visits', (SELECT COALESCE(SUM(visits), 0) FROM vis WHERE d >= v_d30),
      'visits_prev', (SELECT COALESCE(SUM(visits), 0) FROM vis WHERE d >= v_d60 AND d < v_d30),
      'visitors', (SELECT COALESCE(SUM(visitors), 0) FROM vis WHERE d >= v_d30),
      'visitors_prev', (SELECT COALESCE(SUM(visitors), 0) FROM vis WHERE d >= v_d60 AND d < v_d30),
      'forum_threads', (SELECT COUNT(*) FROM public.forum_threads WHERE NOT hidden AND created_at >= v_d30),
      'feedback', (SELECT COUNT(*) FROM public.site_feedback WHERE created_at >= v_d30),
      -- Edited a project or used the AI in the last 30 days.
      'active_users', (
        SELECT COUNT(DISTINCT u) FROM (
          SELECT user_id AS u FROM prj WHERE updated_at >= v_d30
          UNION SELECT user_id FROM ai WHERE d >= v_d30
        ) x WHERE u IS NOT NULL
      ),
      'active_projects', (SELECT COUNT(*) FROM resp_by_project WHERE last30 > 0)
    ),
    'funnel', jsonb_build_object(
      'users', (SELECT COUNT(*) FROM usr),
      'with_project', (SELECT COUNT(*) FROM owner_stats),
      'published', (SELECT COUNT(*) FROM owner_stats WHERE published),
      'with_responses', (SELECT COUNT(*) FROM owner_stats WHERE responses > 0),
      'with_50', (SELECT COUNT(*) FROM owner_stats WHERE responses >= 50)
    ),
    'project_kinds', jsonb_build_object(
      'sp_scheme', (SELECT COUNT(*) FROM prj WHERE sp_scheme),
      'classic', (SELECT COUNT(*) FROM prj WHERE NOT sp_scheme)
    ),
    'days', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', to_char(days.d, 'YYYY-MM-DD'),
        'users', (SELECT COUNT(*) FROM usr WHERE usr.d = days.d),
        'projects', (SELECT COUNT(*) FROM prj WHERE prj.d = days.d),
        'responses', (SELECT COUNT(*) FROM resp WHERE resp.d = days.d),
        'visits', (SELECT COALESCE(SUM(visits), 0) FROM vis WHERE vis.d = days.d),
        'visitors', (SELECT COALESCE(SUM(visitors), 0) FROM vis WHERE vis.d = days.d)
      ) ORDER BY days.d), '[]'::jsonb)
      FROM days
    ),
    'months', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', to_char(months.m, 'YYYY-MM'),
        'users', (SELECT COUNT(*) FROM usr WHERE date_trunc('month', usr.d) = months.m),
        'projects', (SELECT COUNT(*) FROM prj WHERE date_trunc('month', prj.d) = months.m),
        'responses', (SELECT COUNT(*) FROM resp WHERE date_trunc('month', resp.d) = months.m),
        'visits', (SELECT COALESCE(SUM(visits), 0) FROM vis WHERE date_trunc('month', vis.d) = months.m),
        'visitors', (SELECT COALESCE(SUM(visitors), 0) FROM vis WHERE date_trunc('month', vis.d) = months.m)
      ) ORDER BY months.m), '[]'::jsonb)
      FROM months
    ),
    -- Totals before the 12-month window, for running totals.
    'before', jsonb_build_object(
      'users', (SELECT COUNT(*) FROM usr WHERE d < v_m12),
      'projects', (SELECT COUNT(*) FROM prj WHERE d < v_m12),
      'responses', (SELECT COUNT(*) FROM resp WHERE d < v_m12)
    ),
    'top_projects', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.last30 DESC, t.total DESC), '[]'::jsonb) FROM (
        SELECT p.id, p.name, u.email AS owner_email, p.sp_scheme, rp.last30, rp.total
        FROM resp_by_project rp
        JOIN prj p ON p.id = rp.project_id
        LEFT JOIN auth.users u ON u.id = p.user_id
        WHERE rp.last30 > 0
        ORDER BY rp.last30 DESC, rp.total DESC
        LIMIT 10
      ) t
    ),
    'ai', jsonb_build_object(
      'since', (SELECT MIN(created_at) FROM ai WHERE NOT estimated),
      'estimated_since', (SELECT MIN(created_at) FROM ai WHERE estimated),
      'all', (
        SELECT jsonb_build_object(
          'calls', COUNT(*),
          'free_usd', COALESCE(SUM(cost) FILTER (WHERE ours AND source = 'subsidy'), 0),
          'own_usd', COALESCE(SUM(cost) FILTER (WHERE ours AND source = 'user'), 0),
          'estimated_usd', COALESCE(SUM(cost) FILTER (WHERE ours AND estimated), 0),
          'free_users', COUNT(DISTINCT user_id) FILTER (WHERE source = 'subsidy')
        ) FROM ai
      ),
      'd30', (
        SELECT jsonb_build_object(
          'calls', COUNT(*),
          'free_calls', COUNT(*) FILTER (WHERE source = 'subsidy'),
          'free_usd', COALESCE(SUM(cost) FILTER (WHERE ours AND source = 'subsidy'), 0),
          'own_usd', COALESCE(SUM(cost) FILTER (WHERE ours AND source = 'user'), 0),
          'free_users', COUNT(DISTINCT user_id) FILTER (WHERE source = 'subsidy'),
          'ai_users', COUNT(DISTINCT user_id),
          'byok_users', COUNT(DISTINCT user_id) FILTER (WHERE source = 'user' AND NOT ours),
          'tokens', COALESCE(SUM(prompt_tokens + completion_tokens), 0),
          'cache_read_tokens', COALESCE(SUM(cache_read_tokens), 0),
          'prompt_tokens', COALESCE(SUM(prompt_tokens), 0)
        ) FROM ai WHERE d >= v_d30
      ),
      'month', (
        SELECT jsonb_build_object(
          'free_usd', COALESCE(SUM(cost) FILTER (WHERE ours AND source = 'subsidy'), 0),
          'own_usd', COALESCE(SUM(cost) FILTER (WHERE ours AND source = 'user'), 0)
        ) FROM ai WHERE d >= v_mon
      ),
      'days', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'day', to_char(days.d, 'YYYY-MM-DD'),
          'free_usd', (SELECT COALESCE(SUM(cost), 0) FROM ai WHERE ai.d = days.d AND ours AND source = 'subsidy'),
          'own_usd', (SELECT COALESCE(SUM(cost), 0) FROM ai WHERE ai.d = days.d AND ours AND source = 'user'),
          'calls', (SELECT COUNT(*) FROM ai WHERE ai.d = days.d)
        ) ORDER BY days.d), '[]'::jsonb)
        FROM days
      ),
      'months', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'month', to_char(months.m, 'YYYY-MM'),
          'free_usd', (SELECT COALESCE(SUM(cost), 0) FROM ai WHERE date_trunc('month', ai.d) = months.m AND ours AND source = 'subsidy'),
          'own_usd', (SELECT COALESCE(SUM(cost), 0) FROM ai WHERE date_trunc('month', ai.d) = months.m AND ours AND source = 'user'),
          'calls', (SELECT COUNT(*) FROM ai WHERE date_trunc('month', ai.d) = months.m)
        ) ORDER BY months.m), '[]'::jsonb)
        FROM months
      ),
      'features', (
        SELECT COALESCE(jsonb_agg(f ORDER BY f.usd DESC, f.calls DESC), '[]'::jsonb) FROM (
          SELECT feature, COUNT(*) AS calls, COUNT(DISTINCT user_id) AS users,
            COALESCE(SUM(cost) FILTER (WHERE ours), 0) AS usd
          FROM ai WHERE d >= v_d30 GROUP BY feature
        ) f
      ),
      'models', (
        SELECT COALESCE(jsonb_agg(m ORDER BY m.usd DESC, m.calls DESC), '[]'::jsonb) FROM (
          SELECT provider, model, COUNT(*) AS calls,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(cost) FILTER (WHERE ours), 0) AS usd,
            bool_or(ours AND cost_usd IS NULL) AS unpriced
          FROM ai WHERE d >= v_d30 AND ours GROUP BY provider, model
        ) m
      ),
      'free_users', (
        SELECT COALESCE(jsonb_agg(x ORDER BY x.usd DESC, x.calls DESC), '[]'::jsonb) FROM (
          SELECT u.email, COUNT(*) AS calls, COUNT(DISTINCT ai.project_id) AS projects,
            COALESCE(SUM(ai.prompt_tokens + ai.completion_tokens), 0) AS tokens,
            COALESCE(SUM(ai.cost), 0) AS usd, MAX(ai.created_at) AS last_at
          FROM ai LEFT JOIN auth.users u ON u.id = ai.user_id
          WHERE ai.d >= v_d30 AND ai.source = 'subsidy'
          GROUP BY u.email
          ORDER BY usd DESC, calls DESC
          LIMIT 15
        ) x
      )
    ),
    'subsidy', (
      SELECT jsonb_build_object(
        'enabled', s.enabled,
        'expires_at', s.expires_at,
        'routes', s.allowed_routes
      ) FROM public.platform_assistant_subsidy s WHERE s.id = 1
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_dashboard() TO authenticated;
