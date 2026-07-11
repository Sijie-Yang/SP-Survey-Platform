-- Pin templates to the top of the project-editor template library.
-- Run once in Supabase SQL Editor (admin UPDATE already covered by existing RLS).

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.templates.is_pinned IS
  'When true, template appears at the top of the Project Templates list for all users.';
