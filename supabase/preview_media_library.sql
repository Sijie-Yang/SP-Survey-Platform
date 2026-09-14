-- Requires supabase/admin_projects_rls.sql (public.is_platform_admin()).
-- Global preview assets are public; only platform admins may change organization.
BEGIN;

CREATE TABLE IF NOT EXISTS public.preview_media_library (
  id TEXT PRIMARY KEY CHECK (id = 'shared'),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  preloaded_images JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preloaded_images) = 'array'),
  image_dataset_config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(image_dataset_config) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.preview_media_library(id) VALUES ('shared') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.preview_media_library ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preview_media_library FROM anon, authenticated;
GRANT SELECT ON public.preview_media_library TO anon, authenticated;
DROP POLICY IF EXISTS "Read shared preview media" ON public.preview_media_library;
CREATE POLICY "Read shared preview media" ON public.preview_media_library
  FOR SELECT TO anon, authenticated USING (true);

-- All writes use compare-and-swap. No direct client UPDATE policy bypasses it.
CREATE OR REPLACE FUNCTION public.save_preview_media_library(
  p_expected_revision BIGINT, p_images JSONB, p_config JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.preview_media_library%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_platform_admin(), false) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Expected revision is required' USING ERRCODE = '22023';
  END IF;
  IF p_images IS NULL OR jsonb_typeof(p_images) <> 'array'
     OR p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'Invalid media library payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_images) AS e
      WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'key', '') NOT LIKE 'skill-preview/%') THEN
    RAISE EXCEPTION 'Only shared preview media keys are allowed' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_config->'mediaFolders', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_config->'mediaFolderTags', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid folder configuration' USING ERRCODE = '22023';
  END IF;
  UPDATE public.preview_media_library SET
    preloaded_images = p_images,
    image_dataset_config = jsonb_build_object(
      'mediaFolders', COALESCE(p_config->'mediaFolders', '[]'::jsonb),
      'mediaFolderTags', COALESCE(p_config->'mediaFolderTags', '{}'::jsonb)),
    revision = revision + 1, updated_at = clock_timestamp()
  WHERE id = 'shared' AND revision = p_expected_revision
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media library changed. Reload before saving.' USING ERRCODE = '40001';
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.save_preview_media_library(BIGINT, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_preview_media_library(BIGINT, JSONB, JSONB) TO authenticated;
COMMIT;
