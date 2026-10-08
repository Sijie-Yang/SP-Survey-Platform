-- Project collaborators and presence.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- What this does
--   * The project owner can add an existing account (by email) as a collaborator.
--   * That collaborator can read and update that project and its survey config.
--   * Survey responses for that project stay visible to the owner and the collaborator.
--   * Other projects are unchanged: membership is checked per project id.
--   * A lightweight presence row records who currently has the project open.
--     It is not co-editing. A later save replaces the draft (last write wins
--     when no concurrency token is sent).
--
-- 在 Supabase SQL 编辑器中执行一次即可。可重复执行。
-- 项目所有者按邮箱添加已有账号为协作者；协作者可读写该项目及其问卷配置；
-- 该项目的答卷对所有者和协作者可见；其他项目的权限不变。
-- 在线状态只表示谁打开了项目，不是同一字段的实时共编。

-- ── Membership helper ────────────────────────────────────────────────────────
-- Returns false when the table does not exist yet, so owner-only saves keep working.

CREATE OR REPLACE FUNCTION public.is_project_collaborator(p_project_id TEXT)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member boolean;
BEGIN
  IF auth.uid() IS NULL OR p_project_id IS NULL THEN
    RETURN false;
  END IF;
  IF to_regclass('public.project_collaborators') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE
    'SELECT EXISTS (SELECT 1 FROM public.project_collaborators WHERE project_id = $1 AND user_id = auth.uid())'
    INTO v_member
    USING p_project_id;
  RETURN COALESCE(v_member, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_project_collaborator(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_collaborator(TEXT) TO authenticated;

-- ── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_collaborators (
  project_id   TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_collaborators_user_idx
  ON public.project_collaborators (user_id);

CREATE TABLE IF NOT EXISTS public.project_presence (
  project_id    TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  email         TEXT,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_presence_seen_idx
  ON public.project_presence (project_id, last_seen_at DESC);

ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_presence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.project_collaborators FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.project_presence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_collaborators TO authenticated;
GRANT SELECT ON public.project_presence TO authenticated;

-- ── Owner column stays with the owner ────────────────────────────────────────
-- Collaborator updates must not transfer user_id. Service role (auth.uid() null)
-- and the current owner can still change it. Platform admins can too.

CREATE OR REPLACE FUNCTION public.protect_project_owner_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_admin boolean := false;
BEGIN
  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR auth.uid() = OLD.user_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_admin := public.is_platform_admin();
  EXCEPTION WHEN undefined_function THEN
    v_admin := false;
  END;
  IF COALESCE(v_admin, false) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'only the project owner can transfer this project';
END;
$$;

DROP TRIGGER IF EXISTS protect_project_owner_column ON public.projects;
CREATE TRIGGER protect_project_owner_column
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_project_owner_column();

-- ── Project access ───────────────────────────────────────────────────────────
-- Owner policy is left in place. These add the collaborator, and only that project.

DROP POLICY IF EXISTS "Collaborators read shared projects" ON public.projects;
CREATE POLICY "Collaborators read shared projects"
  ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_project_collaborator(id));

DROP POLICY IF EXISTS "Collaborators update shared projects" ON public.projects;
CREATE POLICY "Collaborators update shared projects"
  ON public.projects
  FOR UPDATE TO authenticated
  USING (public.is_project_collaborator(id))
  WITH CHECK (public.is_project_collaborator(id));

DROP POLICY IF EXISTS "Members read collaborator list" ON public.project_collaborators;
CREATE POLICY "Members read collaborator list"
  ON public.project_collaborators
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_collaborators.project_id
        AND p.user_id = auth.uid()
    )
    OR public.is_project_collaborator(project_id)
  );

DROP POLICY IF EXISTS "Members read project presence" ON public.project_presence;
CREATE POLICY "Members read project presence"
  ON public.project_presence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_presence.project_id
        AND p.user_id = auth.uid()
    )
    OR public.is_project_collaborator(project_presence.project_id)
  );

-- Responses: owner policies stay. Collaborators of THIS project can read and delete.
DO $responses$
BEGIN
  IF to_regclass('public.survey_responses') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS "survey_responses_collaborator_select" ON public.survey_responses';
  EXECUTE $pol$
    CREATE POLICY "survey_responses_collaborator_select"
      ON public.survey_responses
      FOR SELECT TO authenticated
      USING (
        project_id IS NOT NULL
        AND public.is_project_collaborator(project_id)
      )
  $pol$;
  EXECUTE 'DROP POLICY IF EXISTS "survey_responses_collaborator_delete" ON public.survey_responses';
  EXECUTE $pol$
    CREATE POLICY "survey_responses_collaborator_delete"
      ON public.survey_responses
      FOR DELETE TO authenticated
      USING (
        project_id IS NOT NULL
        AND public.is_project_collaborator(project_id)
      )
  $pol$;
END
$responses$;

DO $versions$
BEGIN
  IF to_regclass('public.project_config_versions') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS "Collaborators read shared project versions" ON public.project_config_versions';
  EXECUTE $pol$
    CREATE POLICY "Collaborators read shared project versions"
      ON public.project_config_versions
      FOR SELECT TO authenticated
      USING (public.is_project_collaborator(project_id))
  $pol$;
END
$versions$;

-- ── Invite / remove / list (owner invites; both can list) ────────────────────

CREATE OR REPLACE FUNCTION public.add_project_collaborator(p_project_id TEXT, p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_user_id uuid;
  v_meta jsonb;
  v_name text;
  v_found_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only the project owner can add a collaborator';
  END IF;

  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'enter a valid email';
  END IF;

  SELECT u.id, u.email, u.raw_user_meta_data
    INTO v_user_id, v_found_email, v_meta
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no account for that email';
  END IF;
  IF v_user_id = auth.uid() THEN
    RAISE EXCEPTION 'you already own this project';
  END IF;

  v_name := coalesce(
    nullif(v_meta->>'full_name', ''),
    nullif(v_meta->>'name', ''),
    split_part(v_email, '@', 1)
  );

  INSERT INTO public.project_collaborators (project_id, user_id, email, display_name, invited_by)
  VALUES (p_project_id, v_user_id, coalesce(v_found_email, v_email), v_name, auth.uid())
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = EXCLUDED.display_name;

  RETURN jsonb_build_object(
    'projectId', p_project_id,
    'userId', v_user_id,
    'email', coalesce(v_found_email, v_email),
    'displayName', v_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_project_collaborator(p_project_id TEXT, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only the project owner can remove a collaborator';
  END IF;
  DELETE FROM public.project_collaborators
  WHERE project_id = p_project_id AND user_id = p_user_id;
  DELETE FROM public.project_presence
  WHERE project_id = p_project_id AND user_id = p_user_id;
  RETURN jsonb_build_object('removed', true, 'userId', p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_project_collaborators(p_project_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND user_id = auth.uid()
  ) AND NOT public.is_project_collaborator(p_project_id) THEN
    RAISE EXCEPTION 'project not found';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'userId', c.user_id,
      'email', c.email,
      'displayName', c.display_name,
      'createdAt', c.created_at
    ) ORDER BY c.created_at), '[]'::jsonb)
    FROM public.project_collaborators c
    WHERE c.project_id = p_project_id
  );
END;
$$;

-- Presence is heartbeat-only. Rows older than 70s are treated as gone.
-- Leaving deletes the caller's row immediately.

CREATE OR REPLACE FUNCTION public.touch_project_presence(p_project_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_meta jsonb;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND user_id = auth.uid()
  ) AND NOT public.is_project_collaborator(p_project_id) THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  SELECT u.email, u.raw_user_meta_data INTO v_email, v_meta
  FROM auth.users u WHERE u.id = auth.uid();
  v_name := coalesce(
    nullif(v_meta->>'full_name', ''),
    nullif(v_meta->>'name', ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    'Member'
  );

  INSERT INTO public.project_presence (project_id, user_id, display_name, email, last_seen_at)
  VALUES (p_project_id, auth.uid(), v_name, v_email, now())
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        last_seen_at = now();

  DELETE FROM public.project_presence
  WHERE project_id = p_project_id
    AND last_seen_at < now() - interval '70 seconds';

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'userId', pr.user_id,
      'displayName', pr.display_name,
      'email', pr.email,
      'lastSeenAt', pr.last_seen_at
    ) ORDER BY pr.display_name), '[]'::jsonb)
    FROM public.project_presence pr
    WHERE pr.project_id = p_project_id
      AND pr.user_id IS DISTINCT FROM auth.uid()
      AND pr.last_seen_at >= now() - interval '70 seconds'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_project_presence(p_project_id TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_project_id IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM public.project_presence
  WHERE project_id = p_project_id AND user_id = auth.uid();
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.add_project_collaborator(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_project_collaborator(TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_project_collaborators(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_project_presence(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_project_presence(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_project_collaborator(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_project_collaborator(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_project_collaborators(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_project_presence(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_project_presence(TEXT) TO authenticated;

-- ── Survey-config procedures ─────────────────────────────────────────────────
-- Re-apply the current save / release functions so an existing database picks
-- up collaborator writes without re-running the older scripts. The bodies match
-- supabase/save_project_draft_revision_id.sql and supabase/research_releases.sql.

CREATE OR REPLACE FUNCTION public.save_project_draft(
  p_project_id TEXT,
  p_survey_config JSONB,
  p_expected_draft_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_writer JSONB DEFAULT '{}'::jsonb,
  p_client_mutation_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_revision TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT draft_updated_at INTO v_current
  FROM public.projects
  WHERE id = p_project_id
    AND (user_id = auth.uid() OR public.is_project_collaborator(id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  IF p_expected_draft_updated_at IS NOT NULL
     AND v_current IS NOT NULL
     AND p_expected_draft_updated_at <> v_current THEN
    RAISE EXCEPTION 'conflict: draft changed'
      USING ERRCODE = '40001';
  END IF;

  v_revision := coalesce(
    p_client_mutation_id,
    'rev_' || left(replace(gen_random_uuid()::text, '-', ''), 16)
  );

  UPDATE public.projects SET
    survey_config = p_survey_config,
    survey_config_draft = p_survey_config,
    draft_updated_at = v_now,
    updated_at = v_now,
    revision_id = v_revision,
    last_writer = COALESCE(p_writer, '{}'::jsonb) || jsonb_build_object('at', v_now)
  WHERE id = p_project_id
    AND (user_id = auth.uid() OR public.is_project_collaborator(id));

  PERFORM public.write_audit_event(
    'project.save',
    p_project_id,
    'project',
    p_project_id,
    jsonb_build_object('revisionId', v_revision, 'writer', p_writer)
  );

  RETURN jsonb_build_object(
    'draftUpdatedAt', v_now,
    'revisionId', v_revision
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_project_draft(TEXT, JSONB, TIMESTAMPTZ, JSONB, TEXT) TO authenticated;

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

REVOKE ALL ON FUNCTION public.release_project_version(TEXT, TIMESTAMPTZ, TEXT, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_project_version(TEXT, TIMESTAMPTZ, TEXT, INTEGER, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_project_config(p_project_id TEXT, p_summary TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stamp TIMESTAMPTZ;
BEGIN
  SELECT draft_updated_at INTO v_stamp FROM public.projects
    WHERE id = p_project_id AND (user_id = auth.uid() OR public.is_project_collaborator(id)) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found';
  END IF;
  RETURN public.release_project_version(p_project_id, v_stamp, p_summary);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_project_config(p_project_id TEXT, p_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stamp TIMESTAMPTZ;
BEGIN
  SELECT draft_updated_at INTO v_stamp FROM public.projects
    WHERE id = p_project_id AND (user_id = auth.uid() OR public.is_project_collaborator(id)) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found';
  END IF;
  RETURN public.release_project_version(p_project_id, v_stamp, NULL, p_version);
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_project_config(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_project_config(TEXT, INTEGER) TO authenticated;
