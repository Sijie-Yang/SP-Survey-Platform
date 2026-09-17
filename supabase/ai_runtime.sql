-- SP-Survey Agent Runtime: multi-provider credentials, settings, sessions.
-- Additive and idempotent. Worker uses service role; browser never reads ciphertext.

-- ── Multi-provider encrypted credentials ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_ai_provider_credentials (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('deepseek', 'openrouter', 'openai', 'custom')),
  key_ciphertext BYTEA NOT NULL,
  key_nonce BYTEA NOT NULL,
  key_version SMALLINT NOT NULL DEFAULT 1,
  key_hint TEXT NOT NULL,
  base_url TEXT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.user_ai_provider_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_ai_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_provider TEXT NOT NULL DEFAULT 'deepseek',
  assistant_provider TEXT,
  assistant_model TEXT,
  fast_provider TEXT,
  fast_model TEXT,
  silicon_provider TEXT,
  silicon_model TEXT,
  temperature DOUBLE PRECISION DEFAULT 0.4,
  max_tokens INTEGER DEFAULT 4096,
  reasoning_effort TEXT,
  permission TEXT NOT NULL DEFAULT 'edit_draft'
    CHECK (permission IN ('ask', 'edit_draft', 'media')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ai_settings ENABLE ROW LEVEL SECURITY;

-- ── Sessions / runs / append-only events ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'designer' CHECK (mode IN ('designer', 'respondent')),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_sessions_user_updated_idx
  ON public.ai_sessions (user_id, updated_at DESC);

ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own ai sessions" ON public.ai_sessions;
CREATE POLICY "Owners read own ai sessions" ON public.ai_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
  provider TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error_summary TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_runs_session_idx ON public.ai_runs (session_id, created_at DESC);

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own ai runs" ON public.ai_runs;
CREATE POLICY "Owners read own ai runs" ON public.ai_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.ai_session_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS ai_session_events_session_seq_idx
  ON public.ai_session_events (session_id, seq);

ALTER TABLE public.ai_session_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own ai session events" ON public.ai_session_events;
CREATE POLICY "Owners read own ai session events" ON public.ai_session_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.ai_session_events IS
  'Append-only Agent Runtime events. Worker writes via service role.';

-- ── Harness-style provider profiles (additive; safe to re-run) ────────────────

ALTER TABLE public.user_ai_provider_credentials
  DROP CONSTRAINT IF EXISTS user_ai_provider_credentials_provider_check;

ALTER TABLE public.user_ai_provider_credentials
  ADD CONSTRAINT user_ai_provider_credentials_provider_check
  CHECK (provider ~ '^[a-z][a-z0-9_-]{0,47}$');

ALTER TABLE public.user_ai_provider_credentials
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE public.user_ai_provider_credentials
  ADD COLUMN IF NOT EXISTS protocol TEXT DEFAULT 'openai-completions';

ALTER TABLE public.user_ai_provider_credentials
  ADD COLUMN IF NOT EXISTS models JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.user_ai_settings
  ADD COLUMN IF NOT EXISTS provider_profiles JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_ai_settings
  ADD COLUMN IF NOT EXISTS settings_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.user_ai_settings
  ADD COLUMN IF NOT EXISTS assistant_reasoning_effort TEXT;

ALTER TABLE public.user_ai_settings
  ADD COLUMN IF NOT EXISTS silicon_reasoning_effort TEXT;

ALTER TABLE public.ai_sessions
  ADD COLUMN IF NOT EXISTS reasoning_effort TEXT;

ALTER TABLE public.ai_sessions
  ADD COLUMN IF NOT EXISTS selection_locked BOOLEAN NOT NULL DEFAULT false;

-- ── Durable Harness-style runs (additive; safe to re-run) ────────────────────

ALTER TABLE public.ai_sessions
  ADD COLUMN IF NOT EXISTS assistant_mode TEXT NOT NULL DEFAULT 'agent';

ALTER TABLE public.ai_sessions
  DROP CONSTRAINT IF EXISTS ai_sessions_assistant_mode_check;

ALTER TABLE public.ai_sessions
  ADD CONSTRAINT ai_sessions_assistant_mode_check
  CHECK (assistant_mode IN ('agent', 'generate', 'adjust', 'question'));

ALTER TABLE public.ai_runs
  DROP CONSTRAINT IF EXISTS ai_runs_status_check;

ALTER TABLE public.ai_runs
  ADD CONSTRAINT ai_runs_status_check
  CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'cancelled', 'failed'));

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS assistant_mode TEXT NOT NULL DEFAULT 'agent';

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS result JSONB;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS approval_request JSONB;

CREATE INDEX IF NOT EXISTS ai_runs_user_project_status_idx
  ON public.ai_runs (user_id, project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_agent_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('next-turn', 'next-step')),
  kind TEXT NOT NULL DEFAULT 'followup' CHECK (kind IN ('followup', 'steer', 'inject')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'discarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_agent_inbox_session_status_idx
  ON public.ai_agent_inbox (session_id, status, created_at);

ALTER TABLE public.ai_agent_inbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own ai agent inbox" ON public.ai_agent_inbox;
CREATE POLICY "Owners read own ai agent inbox" ON public.ai_agent_inbox
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.ai_run_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('publish', 'delete', 'upload')),
  arguments_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  UNIQUE (run_id, tool_call_id)
);

ALTER TABLE public.ai_run_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own ai run approvals" ON public.ai_run_approvals;
CREATE POLICY "Owners manage own ai run approvals" ON public.ai_run_approvals
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Serialize sequence allocation so concurrent parallel tool results cannot
-- produce duplicate (session_id, seq) values.
CREATE OR REPLACE FUNCTION public.append_ai_session_event(
  p_session_id UUID,
  p_run_id UUID,
  p_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text));
  SELECT COALESCE(MAX(seq), 0) + 1
    INTO v_seq
    FROM public.ai_session_events
    WHERE session_id = p_session_id;

  INSERT INTO public.ai_session_events (session_id, run_id, seq, type, payload)
  VALUES (p_session_id, p_run_id, v_seq, p_type, COALESCE(p_payload, '{}'::jsonb));

  UPDATE public.ai_sessions
    SET updated_at = now()
    WHERE id = p_session_id;

  RETURN v_seq;
END;
$$;

REVOKE ALL ON FUNCTION public.append_ai_session_event(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_ai_session_event(UUID, UUID, TEXT, JSONB) TO service_role;

-- Provider configuration is separate from write-only credentials.
CREATE TABLE IF NOT EXISTS public.user_ai_provider_profiles (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,47}$'),
  display_name TEXT,
  protocol TEXT NOT NULL DEFAULT 'openai-completions',
  base_url TEXT,
  default_input JSONB NOT NULL DEFAULT '["text"]'::jsonb,
  compat JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  models JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.user_ai_provider_profiles ENABLE ROW LEVEL SECURITY;

INSERT INTO public.user_ai_provider_profiles (
  user_id, provider, display_name, protocol, base_url, models, updated_at
)
SELECT
  c.user_id,
  c.provider,
  c.display_name,
  COALESCE(c.protocol, 'openai-completions'),
  c.base_url,
  COALESCE(c.models, '[]'::jsonb),
  now()
FROM public.user_ai_provider_credentials c
ON CONFLICT (user_id, provider) DO NOTHING;

DO $$
BEGIN
  INSERT INTO public.user_ai_provider_credentials (
    user_id, provider, key_ciphertext, key_nonce, key_version, key_hint, validated_at, updated_at
  )
  SELECT
    l.user_id,
    CASE WHEN l.provider IN ('openai', 'openrouter') THEN l.provider ELSE 'openai' END,
    l.key_ciphertext,
    l.key_nonce,
    COALESCE(l.key_version, 1),
    l.key_hint,
    l.validated_at,
    now()
  FROM public.user_ai_credentials l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_ai_provider_credentials p
    WHERE p.user_id = l.user_id AND p.provider = CASE WHEN l.provider IN ('openai', 'openrouter') THEN l.provider ELSE 'openai' END
  )
  ON CONFLICT (user_id, provider) DO NOTHING;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS claimed_by TEXT;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS checkpoint_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.ai_tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'unknown')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, tool_call_id)
);

CREATE INDEX IF NOT EXISTS ai_tool_executions_run_idx
  ON public.ai_tool_executions (run_id, tool_call_id);

ALTER TABLE public.ai_tool_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own ai tool executions" ON public.ai_tool_executions;
CREATE POLICY "Owners read own ai tool executions" ON public.ai_tool_executions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_runs r
      WHERE r.id = ai_tool_executions.run_id AND r.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.claim_ai_run(
  p_run_id UUID,
  p_claimed_by TEXT,
  p_lease_seconds INTEGER DEFAULT 90
)
RETURNS SETOF public.ai_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_runs
    SET claimed_by = p_claimed_by,
        lease_expires_at = now() + make_interval(secs => GREATEST(15, LEAST(p_lease_seconds, 600))),
        status = 'running',
        started_at = COALESCE(started_at, now()),
        updated_at = now()
    WHERE id = p_run_id
      AND status IN ('queued', 'running')
      AND (
        claimed_by IS NULL
        OR lease_expires_at IS NULL
        OR lease_expires_at < now()
        OR claimed_by = p_claimed_by
      )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_run(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ai_run(UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.record_ai_tool_execution(
  p_run_id UUID,
  p_tool_call_id TEXT,
  p_tool_name TEXT,
  p_idempotency_key TEXT,
  p_status TEXT,
  p_result JSONB DEFAULT NULL
)
RETURNS public.ai_tool_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ai_tool_executions;
BEGIN
  SELECT * INTO v_row
    FROM public.ai_tool_executions
    WHERE run_id = p_run_id AND tool_call_id = p_tool_call_id
    FOR UPDATE;

  IF FOUND AND v_row.status = 'succeeded' THEN
    RETURN v_row;
  END IF;

  IF FOUND THEN
    UPDATE public.ai_tool_executions
      SET tool_name = COALESCE(p_tool_name, tool_name),
          idempotency_key = COALESCE(p_idempotency_key, idempotency_key),
          status = p_status,
          result = COALESCE(p_result, result),
          updated_at = now()
      WHERE run_id = p_run_id AND tool_call_id = p_tool_call_id
      RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  INSERT INTO public.ai_tool_executions (
    run_id, tool_call_id, tool_name, idempotency_key, status, result
  ) VALUES (
    p_run_id, p_tool_call_id, p_tool_name, COALESCE(p_idempotency_key, p_tool_call_id), p_status, p_result
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_tool_execution(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ai_tool_execution(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
