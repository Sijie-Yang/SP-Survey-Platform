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
