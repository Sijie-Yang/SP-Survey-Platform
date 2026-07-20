-- SP-Survey Agent / MCP platform schema
-- Additive and idempotent. Run in Supabase SQL editor after deploy.

-- ── Draft / publish columns on projects ───────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS survey_config_draft JSONB,
  ADD COLUMN IF NOT EXISTS survey_config_published JSONB,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_id TEXT,
  ADD COLUMN IF NOT EXISTS last_writer JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.projects.metadata IS
  'Researcher project card fields: author, year, category, tags[], website, huggingfaceDataset';

UPDATE public.projects
SET
  survey_config_draft = COALESCE(survey_config_draft, survey_config),
  survey_config_published = COALESCE(survey_config_published, survey_config),
  draft_updated_at = COALESCE(draft_updated_at, updated_at)
WHERE survey_config IS NOT NULL
  AND (survey_config_draft IS NULL OR survey_config_published IS NULL);

-- ── Version history ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  published_by UUID REFERENCES auth.users(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_summary TEXT,
  UNIQUE (project_id, version)
);

ALTER TABLE public.project_config_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own project versions" ON public.project_config_versions;
CREATE POLICY "Owners read own project versions" ON public.project_config_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
    OR public.is_platform_admin()
  );

-- ── Encrypted BYOK credentials (Worker-only access recommended) ───────────────

CREATE TABLE IF NOT EXISTS public.user_ai_credentials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'openrouter')),
  key_ciphertext BYTEA NOT NULL,
  key_nonce BYTEA NOT NULL,
  key_version SMALLINT NOT NULL DEFAULT 1,
  key_hint TEXT NOT NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ai_credentials ENABLE ROW LEVEL SECURITY;

-- No direct browser SELECT of ciphertext. Worker uses service role or narrow RPC.
DROP POLICY IF EXISTS "Users manage own AI credentials" ON public.user_ai_credentials;
-- Deny all for authenticated; Worker uses service role.
-- (If you prefer user JWT writes of ciphertext, add a restricted policy later.)

-- ── Audit events ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  project_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_user_created_idx
  ON public.audit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_project_created_idx
  ON public.audit_events (project_id, created_at DESC);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own audit events" ON public.audit_events;
CREATE POLICY "Users read own audit events" ON public.audit_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all audit events" ON public.audit_events;
CREATE POLICY "Admins read all audit events" ON public.audit_events
  FOR SELECT TO authenticated USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_action TEXT,
  p_project_id TEXT DEFAULT NULL,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_events (user_id, project_id, action, resource_type, resource_id, metadata)
  VALUES (
    auth.uid(),
    p_project_id,
    p_action,
    p_resource_type,
    p_resource_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_audit_event(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ── Edit leases (Codex vs browser) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_edit_leases (
  project_id TEXT PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  holder TEXT NOT NULL CHECK (holder IN ('codex', 'browser', 'human')),
  session_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_edit_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own project leases" ON public.project_edit_leases;
CREATE POLICY "Owners manage own project leases" ON public.project_edit_leases
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

-- ── MCP OAuth tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.mcp_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  resource TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_access_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  resource TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.mcp_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  access_token_hash TEXT REFERENCES public.mcp_access_tokens(token_hash) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  resource TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Ensure PostgREST / service_role can see and write these tables.
GRANT ALL ON TABLE public.mcp_oauth_clients TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.mcp_authorization_codes TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.mcp_access_tokens TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.mcp_refresh_tokens TO postgres, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

DROP POLICY IF EXISTS "Users read own mcp tokens" ON public.mcp_access_tokens;
CREATE POLICY "Users read own mcp tokens" ON public.mcp_access_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users revoke own mcp tokens" ON public.mcp_access_tokens;
CREATE POLICY "Users revoke own mcp tokens" ON public.mcp_access_tokens
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Publish / rollback RPCs ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.publish_project_config(
  p_project_id TEXT,
  p_summary TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft JSONB;
  v_ver INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT survey_config_draft, COALESCE(published_version, 0) + 1
    INTO v_draft, v_ver
  FROM public.projects
  WHERE id = p_project_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found';
  END IF;
  IF v_draft IS NULL THEN
    RAISE EXCEPTION 'draft is empty';
  END IF;

  UPDATE public.projects SET
    survey_config_published = v_draft,
    survey_config = v_draft,
    published_at = now(),
    published_version = v_ver,
    updated_at = now(),
    last_writer = jsonb_build_object('source', 'publish', 'at', now())
  WHERE id = p_project_id;

  INSERT INTO public.project_config_versions (project_id, version, config, published_by, change_summary)
  VALUES (p_project_id, v_ver, v_draft, auth.uid(), p_summary);

  PERFORM public.write_audit_event(
    'project.publish',
    p_project_id,
    'project',
    p_project_id,
    jsonb_build_object('version', v_ver, 'summary', p_summary)
  );

  RETURN jsonb_build_object('publishedVersion', v_ver, 'publishedAt', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_project_config(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_project_config(
  p_project_id TEXT,
  p_version INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config JSONB;
  v_ver INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  SELECT config INTO v_config
  FROM public.project_config_versions
  WHERE project_id = p_project_id AND version = p_version;

  IF v_config IS NULL THEN
    RAISE EXCEPTION 'version not found';
  END IF;

  SELECT COALESCE(published_version, 0) + 1 INTO v_ver
  FROM public.projects WHERE id = p_project_id;

  UPDATE public.projects SET
    survey_config_draft = v_config,
    survey_config_published = v_config,
    survey_config = v_config,
    draft_updated_at = now(),
    published_at = now(),
    published_version = v_ver,
    updated_at = now(),
    last_writer = jsonb_build_object('source', 'rollback', 'fromVersion', p_version, 'at', now())
  WHERE id = p_project_id;

  INSERT INTO public.project_config_versions (project_id, version, config, published_by, change_summary)
  VALUES (p_project_id, v_ver, v_config, auth.uid(), format('Rollback to version %s', p_version));

  PERFORM public.write_audit_event(
    'project.rollback',
    p_project_id,
    'project',
    p_project_id,
    jsonb_build_object('fromVersion', p_version, 'newVersion', v_ver)
  );

  RETURN jsonb_build_object('publishedVersion', v_ver, 'restoredFrom', p_version);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_project_config(TEXT, INTEGER) TO authenticated;

-- Optimistic draft save
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
  WHERE id = p_project_id AND user_id = auth.uid()
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

  v_revision := coalesce(p_client_mutation_id, 'rev_' || encode(gen_random_bytes(8), 'hex'));

  -- Dual-write: save is live. Share / preview always follow the latest config.
  UPDATE public.projects SET
    survey_config = p_survey_config,
    survey_config_draft = p_survey_config,
    draft_updated_at = v_now,
    updated_at = v_now,
    revision_id = v_revision,
    last_writer = COALESCE(p_writer, '{}'::jsonb) || jsonb_build_object('at', v_now)
  WHERE id = p_project_id;

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
