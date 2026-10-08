-- Custom survey links: https://sp-survey.org/s/{slug}
-- Paste this whole file in the Supabase SQL editor. Safe to re-run.
-- Does not change /survey?project={id}. Anonymous participants resolve the
-- slug through resolve_survey_slug, then load the survey with get_survey_project.
-- Rules match src/lib/publicSlug.js: lowercase, 2–40 chars, [a-z0-9] and
-- single hyphens, unique, reserved: admin, api, s, survey, login.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

COMMENT ON COLUMN public.projects.public_slug IS
  'Optional public path segment for /s/{slug}. Null keeps the project-id link only.';

CREATE UNIQUE INDEX IF NOT EXISTS projects_public_slug_key
  ON public.projects (public_slug);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_public_slug_format'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_public_slug_format
      CHECK (
        public_slug IS NULL
        OR (
          char_length(public_slug) BETWEEN 2 AND 40
          AND public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          AND public_slug NOT IN ('admin', 'api', 's', 'survey', 'login')
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_project_public_slug(p_project_id TEXT, p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_slug TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  v_slug := NULLIF(lower(btrim(COALESCE(p_slug, ''))), '');

  IF v_slug IS NOT NULL THEN
    IF v_slug IN ('admin', 'api', 's', 'survey', 'login') THEN
      RAISE EXCEPTION 'slug_reserved' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_slug) < 2
       OR char_length(v_slug) > 40
       OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'slug_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    UPDATE public.projects
    SET public_slug = v_slug,
        updated_at = now()
    WHERE id = p_project_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object('projectId', p_project_id, 'publicSlug', v_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.set_project_public_slug(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_public_slug(TEXT, TEXT) TO authenticated;

-- Returns only the project id. Participants then call get_survey_project(id).
CREATE OR REPLACE FUNCTION public.resolve_survey_slug(p_slug TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.projects p
  WHERE p.public_slug = NULLIF(lower(btrim(COALESCE(p_slug, ''))), '')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_survey_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_survey_slug(TEXT) TO anon, authenticated;
