-- Silicon background runs: leases, per-unit checkpoints, user-scoped task indexes.
-- Additive and idempotent. Apply manually; this file is not auto-applied.

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS claimed_by TEXT;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS progress_processed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS progress_valid INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS progress_failed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS current_stage JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.silicon_runs
  ADD COLUMN IF NOT EXISTS execution_plan JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.silicon_runs
  DROP CONSTRAINT IF EXISTS silicon_runs_status_check;

ALTER TABLE public.silicon_runs
  ADD CONSTRAINT silicon_runs_status_check
  CHECK (status IN ('draft', 'queued', 'running', 'completed', 'cancelled', 'failed', 'partial'));

CREATE INDEX IF NOT EXISTS silicon_runs_user_status_idx
  ON public.silicon_runs (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS silicon_runs_lease_idx
  ON public.silicon_runs (lease_expires_at)
  WHERE status IN ('queued', 'draft', 'running');

CREATE TABLE IF NOT EXISTS public.silicon_answer_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.silicon_runs(id) ON DELETE CASCADE,
  response_id UUID REFERENCES public.silicon_responses(id) ON DELETE SET NULL,
  persona_id UUID,
  repeat_index INTEGER NOT NULL DEFAULT 1,
  question_name TEXT NOT NULL,
  trial_index INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'saved', 'skipped', 'failed', 'unknown')),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  answer JSONB,
  rationale TEXT,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS silicon_answer_units_key_idx
  ON public.silicon_answer_units (run_id, persona_id, repeat_index, question_name, trial_index);

CREATE INDEX IF NOT EXISTS silicon_answer_units_run_status_idx
  ON public.silicon_answer_units (run_id, status);

ALTER TABLE public.silicon_answer_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read silicon answer units" ON public.silicon_answer_units;
CREATE POLICY "Owners read silicon answer units" ON public.silicon_answer_units
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.silicon_runs r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = run_id AND p.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.claim_silicon_run(
  p_run_id UUID,
  p_claimed_by TEXT,
  p_lease_seconds INTEGER DEFAULT 180
)
RETURNS SETOF public.silicon_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.silicon_runs
    SET claimed_by = p_claimed_by,
        lease_expires_at = now() + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 600))),
        status = 'running',
        started_at = COALESCE(started_at, now()),
        updated_at = now()
    WHERE id = p_run_id
      AND status IN ('queued', 'draft', 'running')
      AND COALESCE(cancel_requested, false) = false
      AND (
        claimed_by IS NULL
        OR lease_expires_at IS NULL
        OR lease_expires_at < now()
        OR claimed_by = p_claimed_by
      )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_silicon_run(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_silicon_run(UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_silicon_unit(
  p_run_id UUID,
  p_claimed_by TEXT,
  p_lease_seconds INTEGER DEFAULT 180
)
RETURNS SETOF public.silicon_answer_units
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.silicon_answer_units
    SET status = 'leased',
        lease_owner = p_claimed_by,
        lease_expires_at = now() + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 600))),
        updated_at = now()
    WHERE id = (
      SELECT u.id
      FROM public.silicon_answer_units u
      WHERE u.run_id = p_run_id
        AND (
          u.status IN ('pending', 'unknown')
          OR (u.status = 'leased' AND (u.lease_expires_at IS NULL OR u.lease_expires_at < now()))
        )
      ORDER BY u.repeat_index, u.question_name, u.trial_index, u.created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_silicon_unit(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_silicon_unit(UUID, TEXT, INTEGER) TO service_role;

COMMENT ON TABLE public.silicon_answer_units IS
  'One Silicon pretest answer unit (persona x repeat x question x trial). Source of truth for counts and export.';
