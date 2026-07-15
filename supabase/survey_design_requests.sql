-- Public "Request Survey Design" submissions (guest → service role insert).
-- Run in Supabase SQL Editor before enabling /request-survey-design in production.
-- Requires public.is_platform_admin() from supabase/admin_projects_rls.sql.

CREATE TABLE IF NOT EXISTS public.survey_design_requests (
  id text PRIMARY KEY,
  contact_name text NOT NULL,
  email text NOT NULL,
  affiliation text,
  study_title text NOT NULL,
  research_brief text NOT NULL,
  stimulus_types text[] DEFAULT '{}',
  timeline text,
  related_url text,
  notes text,
  media_files jsonb DEFAULT '[]'::jsonb,
  supplementary_files jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  admin_notes text,
  edit_key text NOT NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent column adds if table already existed without them
ALTER TABLE public.survey_design_requests
  ADD COLUMN IF NOT EXISTS admin_notes text;
ALTER TABLE public.survey_design_requests
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

COMMENT ON TABLE public.survey_design_requests IS
  'Guest requests for custom survey design help (best-effort research collaboration).';

CREATE INDEX IF NOT EXISTS survey_design_requests_status_created_idx
  ON public.survey_design_requests (status, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.survey_design_requests ENABLE ROW LEVEL SECURITY;

-- Guests insert via service role only (Express / Worker API). No anon insert policy.

DROP POLICY IF EXISTS "Admins manage survey_design_requests" ON public.survey_design_requests;
CREATE POLICY "Admins manage survey_design_requests" ON public.survey_design_requests
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
