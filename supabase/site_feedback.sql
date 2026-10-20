-- Homepage "suggestions / feedback" box, managed in 平台管理 → 用户建议.
-- Self-contained and idempotent: paste the whole file into the Supabase SQL
-- editor and run it; re-running is safe.
-- Prerequisite: public.is_platform_admin() from admin_projects_rls.sql.
--
-- Anyone can submit, signed in or not. Submissions go only through
-- submit_site_feedback() (no direct INSERT grant), which validates lengths,
-- drops honeypot bots and rate-limits. Signed-in users' account is attached
-- automatically. Only platform admins can read, update or delete rows.
-- For rate limiting an anonymous sender is identified by a salted hash of the
-- request IP that changes every day; the IP itself is never stored.

CREATE TABLE IF NOT EXISTS public.site_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email     text,
  category       text NOT NULL DEFAULT 'suggestion',
  message        text NOT NULL,
  contact_name   text,
  contact_email  text,
  contact_wechat text,
  contact_other  text,
  page_url       text,
  language       text,
  user_agent     text,
  client_hash    text,
  status         text NOT NULL DEFAULT 'new',
  admin_note     text NOT NULL DEFAULT '',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Constraints are (re)added by name so an older copy of the table is upgraded.
ALTER TABLE public.site_feedback DROP CONSTRAINT IF EXISTS site_feedback_category_check;
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_category_check
  CHECK (category IN ('suggestion', 'bug', 'feature', 'other'));
ALTER TABLE public.site_feedback DROP CONSTRAINT IF EXISTS site_feedback_status_check;
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_status_check
  CHECK (status IN ('new', 'read', 'planned', 'done', 'archived'));
ALTER TABLE public.site_feedback DROP CONSTRAINT IF EXISTS site_feedback_lengths_check;
ALTER TABLE public.site_feedback ADD CONSTRAINT site_feedback_lengths_check CHECK (
  length(btrim(message)) BETWEEN 2 AND 5000
  AND coalesce(length(contact_name), 0) <= 100
  AND coalesce(length(contact_email), 0) <= 200
  AND coalesce(length(contact_wechat), 0) <= 100
  AND coalesce(length(contact_other), 0) <= 200
  AND coalesce(length(page_url), 0) <= 500
  AND coalesce(length(language), 0) <= 20
  AND coalesce(length(user_agent), 0) <= 400
  AND length(admin_note) <= 4000
);

CREATE INDEX IF NOT EXISTS site_feedback_created_idx ON public.site_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS site_feedback_status_idx ON public.site_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS site_feedback_user_idx ON public.site_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_feedback_client_idx ON public.site_feedback (client_hash, created_at DESC);

-- One random salt for the daily IP hash, readable only by the functions below.
CREATE TABLE IF NOT EXISTS public.site_feedback_salt (
  id   boolean PRIMARY KEY DEFAULT true CHECK (id),
  salt text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text)
);
INSERT INTO public.site_feedback_salt (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.site_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_feedback_salt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read site_feedback" ON public.site_feedback;
CREATE POLICY "Admins read site_feedback" ON public.site_feedback
  FOR SELECT TO authenticated USING (public.is_platform_admin());
DROP POLICY IF EXISTS "Admins update site_feedback" ON public.site_feedback;
CREATE POLICY "Admins update site_feedback" ON public.site_feedback
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
DROP POLICY IF EXISTS "Admins delete site_feedback" ON public.site_feedback;
CREATE POLICY "Admins delete site_feedback" ON public.site_feedback
  FOR DELETE TO authenticated USING (public.is_platform_admin());

REVOKE ALL ON public.site_feedback, public.site_feedback_salt FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.site_feedback TO authenticated;
GRANT UPDATE (status, admin_note, updated_at) ON public.site_feedback TO authenticated;

-- p_input keys (all strings, all optional except message):
--   message, category, contact_name, contact_email, contact_wechat,
--   contact_other, page_url, language, user_agent, website (honeypot)
-- Returns the new row id, or NULL when the honeypot was filled (bots get a
-- normal-looking success and nothing is stored).
CREATE OR REPLACE FUNCTION public.submit_site_feedback(p_input jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_message text := btrim(coalesce(p_input->>'message', ''));
  v_category text := coalesce(nullif(btrim(p_input->>'category'), ''), 'suggestion');
  v_headers json;
  v_ip text;
  v_hash text;
  v_id uuid;
BEGIN
  IF p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'Invalid feedback' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_input->>'website', '')), '') IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF length(v_message) < 2 OR length(v_message) > 5000 THEN
    RAISE EXCEPTION 'Please write between 2 and 5000 characters' USING ERRCODE = '22023';
  END IF;
  IF v_category NOT IN ('suggestion', 'bug', 'feature', 'other') THEN
    v_category := 'other';
  END IF;

  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_ip := btrim(split_part(coalesce(
    v_headers->>'cf-connecting-ip',
    v_headers->>'x-real-ip',
    v_headers->>'x-forwarded-for',
    ''), ',', 1));
  IF v_ip <> '' THEN
    SELECT md5(s.salt || ':' || to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD') || ':' || v_ip)
      INTO v_hash FROM public.site_feedback_salt s;
  END IF;

  -- Serialize per sender so the limits below cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtextextended('site_feedback:' || coalesce(v_uid::text, v_hash, 'anon'), 0));

  IF v_uid IS NOT NULL THEN
    IF (SELECT count(*) FROM public.site_feedback
        WHERE user_id = v_uid AND created_at > now() - interval '1 hour') >= 10 THEN
      RAISE EXCEPTION 'Too many suggestions in a short time; please try again later' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF v_hash IS NOT NULL AND (SELECT count(*) FROM public.site_feedback
        WHERE client_hash = v_hash AND created_at > now() - interval '1 hour') >= 5 THEN
      RAISE EXCEPTION 'Too many suggestions in a short time; please try again later' USING ERRCODE = 'P0001';
    END IF;
    -- Global ceiling on anonymous posts so a botnet cannot flood the table.
    IF (SELECT count(*) FROM public.site_feedback
        WHERE user_id IS NULL AND created_at > now() - interval '1 hour') >= 60 THEN
      RAISE EXCEPTION 'Too many suggestions in a short time; please try again later' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The same text from the same sender within 10 minutes is a double click.
  SELECT f.id INTO v_id FROM public.site_feedback f
  WHERE f.message = v_message
    AND f.created_at > now() - interval '10 minutes'
    AND (CASE WHEN v_uid IS NOT NULL THEN f.user_id = v_uid
              ELSE f.user_id IS NULL AND f.client_hash IS NOT DISTINCT FROM v_hash END)
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  END IF;

  INSERT INTO public.site_feedback (
    user_id, user_email, category, message,
    contact_name, contact_email, contact_wechat, contact_other,
    page_url, language, user_agent, client_hash
  ) VALUES (
    v_uid, v_email, v_category, v_message,
    left(nullif(btrim(p_input->>'contact_name'), ''), 100),
    left(nullif(btrim(p_input->>'contact_email'), ''), 200),
    left(nullif(btrim(p_input->>'contact_wechat'), ''), 100),
    left(nullif(btrim(p_input->>'contact_other'), ''), 200),
    left(nullif(btrim(p_input->>'page_url'), ''), 500),
    left(nullif(btrim(p_input->>'language'), ''), 20),
    left(nullif(btrim(p_input->>'user_agent'), ''), 400),
    v_hash
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_site_feedback(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_site_feedback(jsonb) TO anon, authenticated;
