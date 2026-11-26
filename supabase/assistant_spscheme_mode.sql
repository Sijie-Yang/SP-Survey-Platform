-- Assistant SP-Scheme mode (2026-11): allow assistant_mode = 'spscheme' on sessions.
-- Safe to re-run. Run once in the Supabase SQL editor.

ALTER TABLE public.ai_sessions
  DROP CONSTRAINT IF EXISTS ai_sessions_assistant_mode_check;

ALTER TABLE public.ai_sessions
  ADD CONSTRAINT ai_sessions_assistant_mode_check
  CHECK (assistant_mode IN ('agent', 'spscheme', 'generate', 'adjust', 'question', 'review'));
