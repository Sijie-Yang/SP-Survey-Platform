-- Run after agent_mcp_platform.sql and survey_public_rpcs.sql.
-- Opt-in: existing projects retain their live-save behavior until first release.
BEGIN;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS release_managed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_media JSONB;
ALTER TABLE public.project_config_versions
  ADD COLUMN IF NOT EXISTS media_snapshot JSONB;

-- Draft writers (including older clients) must not change the managed live config.
CREATE OR REPLACE FUNCTION public.protect_released_config()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.release_managed THEN
    NEW.survey_config := NEW.survey_config_published;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_released_config ON public.projects;
CREATE TRIGGER protect_released_config BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.protect_released_config();

CREATE OR REPLACE FUNCTION public.release_project_version(
  p_project_id TEXT,
  p_expected_draft_updated_at TIMESTAMPTZ,
  p_summary TEXT DEFAULT NULL,
  p_restore_version INTEGER DEFAULT NULL,
  p_owner UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner UUID;
  v_project public.projects%ROWTYPE;
  v_config JSONB;
  v_media JSONB;
  v_version INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_owner := auth.uid();
  IF auth.role() = 'service_role' THEN v_owner := p_owner; END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_project FROM public.projects
    WHERE id = p_project_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project not found'; END IF;
  IF p_expected_draft_updated_at IS NULL OR
     p_expected_draft_updated_at IS DISTINCT FROM v_project.draft_updated_at THEN
    RAISE EXCEPTION 'conflict: refresh the draft before releasing' USING ERRCODE = '40001';
  END IF;
  IF p_restore_version IS NOT NULL THEN
    SELECT config, media_snapshot INTO v_config, v_media FROM public.project_config_versions
      WHERE project_id = p_project_id AND version = p_restore_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'version not found'; END IF;
    IF v_media IS NULL THEN
      RAISE EXCEPTION 'This historical snapshot has no media manifest and cannot be restored as a complete release.';
    END IF;
  ELSE
    v_config := COALESCE(v_project.survey_config_draft, v_project.survey_config);
    v_media := jsonb_build_object(
      'preloadedImages', COALESCE(v_project.preloaded_images, '[]'::jsonb),
      'imageDatasetConfig', COALESCE(v_project.image_dataset_config, '{}'::jsonb)
        - 'huggingFaceToken' - 'falApiKey' - 'falKey' - 'supabaseKey'
        - 'supabaseAnonKey' - 'openaiApiKey' - 'apiKey',
      'preloadedAt', v_project.preloaded_at, 'preloadedSource', v_project.preloaded_source);
  END IF;
  IF v_config IS NULL OR jsonb_typeof(v_config->'pages') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_config->'pages') = 0 THEN RAISE EXCEPTION 'draft has no pages'; END IF;
  SELECT GREATEST(v_project.published_version, COALESCE(MAX(version), 0)) + 1
    INTO v_version FROM public.project_config_versions WHERE project_id = p_project_id;
  INSERT INTO public.project_config_versions(project_id, version, config, media_snapshot, published_by, change_summary)
    VALUES(p_project_id, v_version, v_config, v_media, v_owner,
      CASE WHEN p_restore_version IS NULL THEN p_summary ELSE format('Restored from v%s. %s', p_restore_version, COALESCE(p_summary, '')) END);
  UPDATE public.projects SET
    release_managed = true, survey_config_published = v_config, published_media = v_media,
    survey_config = v_config,
    survey_config_draft = CASE WHEN p_restore_version IS NULL THEN survey_config_draft ELSE v_config END,
    preloaded_images = CASE WHEN p_restore_version IS NULL THEN preloaded_images ELSE v_media->'preloadedImages' END,
    image_dataset_config = CASE WHEN p_restore_version IS NULL THEN image_dataset_config
      ELSE (v_media->'imageDatasetConfig') || COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(COALESCE(image_dataset_config,'{}'::jsonb)) WHERE key IN ('huggingFaceToken','falApiKey','falKey','supabaseKey','supabaseAnonKey','openaiApiKey','apiKey')), '{}'::jsonb) END,
    draft_updated_at = v_now, published_at = v_now, published_version = v_version, updated_at = v_now,
    last_writer = jsonb_build_object('source', 'release', 'restoredFrom', p_restore_version, 'at', v_now)
    WHERE id = p_project_id;
  RETURN jsonb_build_object('publishedVersion', v_version, 'publishedAt', v_now,
    'draftUpdatedAt', v_now, 'releaseManaged', true, 'restoredFrom', p_restore_version);
END;
$$;
REVOKE ALL ON FUNCTION public.release_project_version(TEXT,TIMESTAMPTZ,TEXT,INTEGER,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_project_version(TEXT,TIMESTAMPTZ,TEXT,INTEGER,UUID) TO authenticated, service_role;

-- Old release endpoints now use the same atomic transaction; no PATCH/INSERT split.
CREATE OR REPLACE FUNCTION public.publish_project_config(p_project_id TEXT, p_summary TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stamp TIMESTAMPTZ;
BEGIN
  SELECT draft_updated_at INTO v_stamp FROM public.projects WHERE id=p_project_id AND user_id=auth.uid() FOR UPDATE;
  RETURN public.release_project_version(p_project_id, v_stamp, p_summary);
END;
$$;
CREATE OR REPLACE FUNCTION public.rollback_project_config(p_project_id TEXT, p_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stamp TIMESTAMPTZ;
BEGIN
  SELECT draft_updated_at INTO v_stamp FROM public.projects WHERE id=p_project_id AND user_id=auth.uid() FOR UPDATE;
  RETURN public.release_project_version(p_project_id, v_stamp, NULL, p_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_survey_project(p_id TEXT)
RETURNS TABLE(id TEXT, name TEXT, description TEXT, survey_config JSONB,
  image_dataset_config JSONB, preloaded_images JSONB, preloaded_at TIMESTAMPTZ,
  preloaded_source TEXT, template_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT p.id, p.name, p.description,
   public.hydrate_survey_skill_html(CASE WHEN p.release_managed THEN p.survey_config_published
     ELSE COALESCE(p.survey_config_draft, p.survey_config) END)
     || jsonb_build_object('_spPublishedVersion', CASE WHEN p.release_managed THEN p.published_version ELSE NULL END),
   (CASE WHEN p.release_managed THEN p.published_media->'imageDatasetConfig' ELSE p.image_dataset_config END)
      - 'huggingFaceToken' - 'falApiKey' - 'falKey' - 'supabaseKey' - 'supabaseAnonKey' - 'openaiApiKey' - 'apiKey',
   CASE WHEN p.release_managed THEN p.published_media->'preloadedImages' ELSE p.preloaded_images END,
   p.preloaded_at, p.preloaded_source, p.template_id
 FROM public.projects p WHERE p.id = p_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_survey_project(TEXT) TO anon, authenticated;
COMMIT;
