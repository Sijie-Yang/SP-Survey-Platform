-- Incremental: persist after-run inbox items and voided cancel state.
-- Apply after supabase/ai_runtime.sql. Safe to re-run.

ALTER TABLE public.ai_agent_inbox
  DROP CONSTRAINT IF EXISTS ai_agent_inbox_target_check;

ALTER TABLE public.ai_agent_inbox
  ADD CONSTRAINT ai_agent_inbox_target_check
  CHECK (target IN ('next-turn', 'next-step', 'after-run'));

ALTER TABLE public.ai_agent_inbox
  DROP CONSTRAINT IF EXISTS ai_agent_inbox_status_check;

ALTER TABLE public.ai_agent_inbox
  ADD CONSTRAINT ai_agent_inbox_status_check
  CHECK (status IN ('queued', 'claimed', 'discarded', 'voided'));
