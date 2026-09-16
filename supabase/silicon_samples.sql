-- Silicon samples: isolated from survey_responses (never count toward quota).
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.silicon_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS silicon_personas_project_idx
  ON public.silicon_personas (project_id, updated_at DESC);

ALTER TABLE public.silicon_personas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage silicon personas" ON public.silicon_personas;
CREATE POLICY "Owners manage silicon personas" ON public.silicon_personas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.silicon_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'running', 'completed', 'cancelled', 'failed')),
  persona_ids UUID[] NOT NULL DEFAULT '{}',
  repeats INTEGER NOT NULL DEFAULT 1,
  seed INTEGER NOT NULL DEFAULT 42,
  provider TEXT,
  model TEXT,
  reasoning_effort TEXT,
  profile_revision TEXT,
  temperature DOUBLE PRECISION DEFAULT 0.4,
  budget_tokens INTEGER,
  question_names TEXT[],
  source_kind TEXT NOT NULL DEFAULT 'draft' CHECK (source_kind IN ('draft')),
  draft_updated_at TIMESTAMPTZ,
  survey_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  media_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  runtime_version TEXT,
  prompt_version TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS silicon_runs_project_idx
  ON public.silicon_runs (project_id, created_at DESC);

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS reasoning_effort TEXT;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS profile_revision TEXT;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.silicon_runs
  DROP CONSTRAINT IF EXISTS silicon_runs_source_kind_check;

ALTER TABLE public.silicon_runs
  ADD CONSTRAINT silicon_runs_source_kind_check CHECK (source_kind IN ('draft'));

ALTER TABLE public.silicon_runs
  DROP CONSTRAINT IF EXISTS silicon_runs_repeats_check;

ALTER TABLE public.silicon_runs
  ADD CONSTRAINT silicon_runs_repeats_check CHECK (repeats BETWEEN 1 AND 20);

ALTER TABLE public.silicon_runs
  DROP CONSTRAINT IF EXISTS silicon_runs_budget_tokens_check;

ALTER TABLE public.silicon_runs
  ADD CONSTRAINT silicon_runs_budget_tokens_check
  CHECK (budget_tokens IS NULL OR budget_tokens BETWEEN 512 AND 100000);

ALTER TABLE public.silicon_runs
  DROP CONSTRAINT IF EXISTS silicon_runs_tokens_used_check;

ALTER TABLE public.silicon_runs
  ADD CONSTRAINT silicon_runs_tokens_used_check CHECK (tokens_used >= 0);

ALTER TABLE public.silicon_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read silicon runs" ON public.silicon_runs;
CREATE POLICY "Owners read silicon runs" ON public.silicon_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.silicon_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.silicon_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  persona_id UUID REFERENCES public.silicon_personas(id) ON DELETE SET NULL,
  repeat_index INTEGER NOT NULL DEFAULT 1,
  participant_id TEXT NOT NULL,
  responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  displayed_images JSONB,
  survey_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'partial', 'error', 'skipped', 'claimed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS silicon_responses_run_idx
  ON public.silicon_responses (run_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS silicon_responses_run_persona_repeat_idx
  ON public.silicon_responses (run_id, persona_id, repeat_index);

ALTER TABLE public.silicon_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read silicon responses" ON public.silicon_responses;
CREATE POLICY "Owners read silicon responses" ON public.silicon_responses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.silicon_answer_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.silicon_runs(id) ON DELETE CASCADE,
  response_id UUID REFERENCES public.silicon_responses(id) ON DELETE CASCADE,
  question_name TEXT,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS silicon_answer_events_run_idx
  ON public.silicon_answer_events (run_id, id);

ALTER TABLE public.silicon_answer_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read silicon answer events" ON public.silicon_answer_events;
CREATE POLICY "Owners read silicon answer events" ON public.silicon_answer_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.silicon_runs r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = run_id AND p.user_id = auth.uid()
    )
  );

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS persona_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.silicon_runs
  DROP CONSTRAINT IF EXISTS silicon_runs_status_check;

ALTER TABLE public.silicon_runs
  ADD CONSTRAINT silicon_runs_status_check
  CHECK (status IN ('draft', 'queued', 'running', 'completed', 'cancelled', 'failed', 'partial'));

ALTER TABLE public.silicon_responses
  DROP CONSTRAINT IF EXISTS silicon_responses_status_check;

ALTER TABLE public.silicon_responses
  ADD CONSTRAINT silicon_responses_status_check
  CHECK (status IN ('ok', 'partial', 'error', 'skipped', 'claimed'));

COMMENT ON TABLE public.silicon_responses IS
  'Synthetic VLM answers. Never mix with survey_responses quota or default Results.';
