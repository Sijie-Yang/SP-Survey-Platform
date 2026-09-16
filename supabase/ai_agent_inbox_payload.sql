-- Incremental: persist per-item mode/project/parent for after-run dispatch.
-- Apply after supabase/ai_agent_inbox_after_run.sql. Safe to re-run.

ALTER TABLE public.ai_agent_inbox
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_agent_inbox
  DROP CONSTRAINT IF EXISTS ai_agent_inbox_status_check;

ALTER TABLE public.ai_agent_inbox
  ADD CONSTRAINT ai_agent_inbox_status_check
  CHECK (status IN ('queued', 'claimed', 'discarded', 'voided', 'failed'));

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES public.ai_runs(id) ON DELETE SET NULL;

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS inbox_id UUID;
