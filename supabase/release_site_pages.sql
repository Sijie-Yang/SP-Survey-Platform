-- Release SP-Scheme pages (Studio and MCP survey_publish).
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Run it after supabase/project_collaborators.sql (this is that file's
-- release_project_version with one change). If research_releases.sql or
-- project_collaborators.sql is run again later, run this file again after it.
--
-- What this changes
--   * release_project_version used to refuse every draft whose `pages` list is
--     empty ("draft has no pages"). A page imported as it is (SP-Scheme, Studio
--     or MCP sp_scheme_import) has no declared question pages, so it could not
--     be published.
--   * Now a draft passes when it has at least one page OR a non-empty page
--     (survey_config.spSite.html). Everything else is unchanged: owner and
--     collaborator checks, the concurrency token, the version snapshot, the
--     media manifest, rollback, and the grants.
--
-- 在 Supabase SQL 编辑器中执行一次即可，可重复执行。请在
-- supabase/project_collaborators.sql 之后执行；以后若重新执行
-- research_releases.sql 或 project_collaborators.sql，请再执行一次本文件。
-- 以前发布时，没有题目页面的草稿会报错“draft has no pages”；用 SP-Scheme
-- 原样导入的页面没有题目页面，所以无法发布。现在只要有题目页面，或有导入的
-- 页面（spSite.html），就可以发布。其余逻辑不变。

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
  IF auth.role() = 'service_role' THEN
    v_owner := p_owner;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
    SELECT * INTO v_project FROM public.projects
      WHERE id = p_project_id AND user_id = v_owner FOR UPDATE;
  ELSE
    v_owner := auth.uid();
    IF v_owner IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
    SELECT * INTO v_project FROM public.projects
      WHERE id = p_project_id
        AND (user_id = v_owner OR public.is_project_collaborator(id))
      FOR UPDATE;
  END IF;
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
  -- Changed: a page imported with SP-Scheme (spSite.html) may have no question pages.
  IF v_config IS NULL OR NOT (
       COALESCE(CASE WHEN jsonb_typeof(v_config->'pages') = 'array'
                     THEN jsonb_array_length(v_config->'pages') > 0 END, false)
       OR COALESCE(jsonb_typeof(v_config->'spSite'->'html') = 'string'
                   AND length(v_config->'spSite'->>'html') > 0, false)
     ) THEN RAISE EXCEPTION 'draft has no pages'; END IF;
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

REVOKE ALL ON FUNCTION public.release_project_version(TEXT, TIMESTAMPTZ, TEXT, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_project_version(TEXT, TIMESTAMPTZ, TEXT, INTEGER, UUID) TO authenticated, service_role;
