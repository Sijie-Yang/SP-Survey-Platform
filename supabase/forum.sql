-- SP-Forum: public discussion board at /forum.
-- Self-contained and idempotent: paste the whole file into the Supabase SQL
-- editor and run it; re-running is safe.
-- Prerequisite: public.is_platform_admin() from admin_projects_rls.sql.
--
-- Anyone can read visible threads and replies. Only signed-in users can post,
-- and every write goes through the forum_* functions below (no direct INSERT
-- or UPDATE grant), which validate lengths, rate-limit and record the author.
-- The author's e-mail is never stored or shown: posts carry a display name.
-- Thread authors can close / reopen their own threads and delete (hide) their
-- own posts; platform admins can do that for every thread and also pin, hide
-- and restore.

CREATE TABLE IF NOT EXISTS public.forum_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  author_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name      text NOT NULL,
  category         text NOT NULL DEFAULT 'general',
  title            text NOT NULL,
  body             text NOT NULL,
  status           text NOT NULL DEFAULT 'open',
  closed_at        timestamptz,
  pinned           boolean NOT NULL DEFAULT false,
  hidden           boolean NOT NULL DEFAULT false,
  reply_count      integer NOT NULL DEFAULT 0,
  edited_at        timestamptz
);

CREATE TABLE IF NOT EXISTS public.forum_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES public.forum_threads(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  author_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  body        text NOT NULL,
  hidden      boolean NOT NULL DEFAULT false
);

ALTER TABLE public.forum_threads DROP CONSTRAINT IF EXISTS forum_threads_category_check;
ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_category_check
  CHECK (category IN ('announcements', 'general', 'help', 'methods', 'showcase', 'ideas'));
ALTER TABLE public.forum_threads DROP CONSTRAINT IF EXISTS forum_threads_status_check;
ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_status_check
  CHECK (status IN ('open', 'closed'));
ALTER TABLE public.forum_threads DROP CONSTRAINT IF EXISTS forum_threads_lengths_check;
ALTER TABLE public.forum_threads ADD CONSTRAINT forum_threads_lengths_check CHECK (
  length(btrim(title)) BETWEEN 3 AND 200
  AND length(btrim(body)) BETWEEN 1 AND 20000
  AND length(author_name) BETWEEN 1 AND 40
);
ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_lengths_check;
ALTER TABLE public.forum_posts ADD CONSTRAINT forum_posts_lengths_check CHECK (
  length(btrim(body)) BETWEEN 1 AND 20000
  AND length(author_name) BETWEEN 1 AND 40
);

CREATE INDEX IF NOT EXISTS forum_threads_list_idx ON public.forum_threads (hidden, pinned DESC, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS forum_threads_category_idx ON public.forum_threads (category, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS forum_threads_author_idx ON public.forum_threads (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS forum_posts_thread_idx ON public.forum_posts (thread_id, created_at);
CREATE INDEX IF NOT EXISTS forum_posts_author_idx ON public.forum_posts (author_id, created_at DESC);

ALTER TABLE public.forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.forum_threads, public.forum_posts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.forum_threads, public.forum_posts TO anon, authenticated;

-- ── helpers ────────────────────────────────────────────────────────────────

-- Display name: the one the user typed, else their profile name, else
-- "Researcher abcd". Never the e-mail address.
CREATE OR REPLACE FUNCTION public.forum_author_name(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_meta jsonb;
BEGIN
  IF v_name = '' THEN
    SELECT u.raw_user_meta_data INTO v_meta FROM auth.users u WHERE u.id = v_uid;
    v_name := btrim(coalesce(v_meta->>'full_name', v_meta->>'name', v_meta->>'display_name', ''));
  END IF;
  IF v_name = '' OR v_name ~ '@' THEN
    v_name := 'Researcher ' || left(replace(v_uid::text, '-', ''), 4);
  END IF;
  RETURN left(v_name, 40);
END;
$$;

CREATE OR REPLACE FUNCTION public.forum_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_platform_admin();
$$;

DROP POLICY IF EXISTS "Read visible forum threads" ON public.forum_threads;
CREATE POLICY "Read visible forum threads" ON public.forum_threads
  FOR SELECT TO anon, authenticated
  USING (NOT hidden OR public.forum_is_admin());

DROP POLICY IF EXISTS "Read visible forum posts" ON public.forum_posts;
CREATE POLICY "Read visible forum posts" ON public.forum_posts
  FOR SELECT TO anon, authenticated
  USING (
    (NOT hidden AND EXISTS (SELECT 1 FROM public.forum_threads t WHERE t.id = thread_id AND NOT t.hidden))
    OR public.forum_is_admin()
  );

CREATE OR REPLACE FUNCTION public.forum_refresh_thread(p_thread_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.forum_threads t SET
    reply_count = (SELECT count(*) FROM public.forum_posts p WHERE p.thread_id = t.id AND NOT p.hidden),
    last_activity_at = greatest(t.created_at, coalesce(
      (SELECT max(p.created_at) FROM public.forum_posts p WHERE p.thread_id = t.id AND NOT p.hidden), t.created_at))
  WHERE t.id = p_thread_id;
$$;

-- ── writes ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.forum_create_thread(p_title text, p_body text, p_category text DEFAULT 'general', p_author_name text DEFAULT '')
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_body text := btrim(coalesce(p_body, ''));
  v_category text := coalesce(nullif(btrim(p_category), ''), 'general');
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to post' USING ERRCODE = '42501';
  END IF;
  IF length(v_title) < 3 OR length(v_title) > 200 THEN
    RAISE EXCEPTION 'The title needs 3 to 200 characters' USING ERRCODE = '22023';
  END IF;
  IF length(v_body) < 1 OR length(v_body) > 20000 THEN
    RAISE EXCEPTION 'The post needs 1 to 20000 characters' USING ERRCODE = '22023';
  END IF;
  IF v_category NOT IN ('announcements', 'general', 'help', 'methods', 'showcase', 'ideas') THEN
    v_category := 'general';
  END IF;
  IF v_category = 'announcements' AND NOT public.forum_is_admin() THEN
    RAISE EXCEPTION 'Only the platform team can post announcements' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('forum:' || v_uid::text, 0));
  IF NOT public.forum_is_admin() AND (
    (SELECT count(*) FROM public.forum_threads WHERE author_id = v_uid AND created_at > now() - interval '1 hour') >= 5
    OR (SELECT count(*) FROM public.forum_threads WHERE author_id = v_uid AND created_at > now() - interval '1 day') >= 20
  ) THEN
    RAISE EXCEPTION 'Too many new threads in a short time; please try again later' USING ERRCODE = 'P0001';
  END IF;

  -- The same title from the same author within 10 minutes is a double click.
  SELECT t.id INTO v_id FROM public.forum_threads t
  WHERE t.author_id = v_uid AND t.title = v_title AND t.created_at > now() - interval '10 minutes'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.forum_threads (author_id, author_name, category, title, body)
  VALUES (v_uid, public.forum_author_name(p_author_name), v_category, v_title, v_body)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.forum_reply(p_thread_id uuid, p_body text, p_author_name text DEFAULT '')
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_thread public.forum_threads%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to reply' USING ERRCODE = '42501';
  END IF;
  IF length(v_body) < 1 OR length(v_body) > 20000 THEN
    RAISE EXCEPTION 'The reply needs 1 to 20000 characters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_thread FROM public.forum_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR (v_thread.hidden AND NOT public.forum_is_admin()) THEN
    RAISE EXCEPTION 'Thread not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_thread.status = 'closed' AND NOT public.forum_is_admin() THEN
    RAISE EXCEPTION 'This thread is closed' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('forum:' || v_uid::text, 0));
  IF NOT public.forum_is_admin()
    AND (SELECT count(*) FROM public.forum_posts WHERE author_id = v_uid AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Too many replies in a short time; please try again later' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.id INTO v_id FROM public.forum_posts p
  WHERE p.thread_id = p_thread_id AND p.author_id = v_uid AND p.body = v_body
    AND p.created_at > now() - interval '10 minutes'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.forum_posts (thread_id, author_id, author_name, body)
  VALUES (p_thread_id, v_uid, public.forum_author_name(p_author_name), v_body)
  RETURNING id INTO v_id;
  PERFORM public.forum_refresh_thread(p_thread_id);
  RETURN v_id;
END;
$$;

-- Edit the title/body of a thread, or the body of a reply. Author or admin.
CREATE OR REPLACE FUNCTION public.forum_edit(p_kind text, p_id uuid, p_body text, p_title text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_author uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in' USING ERRCODE = '42501';
  END IF;
  IF length(v_body) < 1 OR length(v_body) > 20000 THEN
    RAISE EXCEPTION 'The post needs 1 to 20000 characters' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'thread' THEN
    SELECT author_id INTO v_author FROM public.forum_threads WHERE id = p_id;
  ELSIF p_kind = 'post' THEN
    SELECT author_id INTO v_author FROM public.forum_posts WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Unknown kind' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND OR (v_author IS DISTINCT FROM v_uid AND NOT public.forum_is_admin()) THEN
    RAISE EXCEPTION 'You can only edit your own posts' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'thread' THEN
    IF p_title IS NOT NULL AND (length(v_title) < 3 OR length(v_title) > 200) THEN
      RAISE EXCEPTION 'The title needs 3 to 200 characters' USING ERRCODE = '22023';
    END IF;
    UPDATE public.forum_threads
      SET body = v_body, title = CASE WHEN p_title IS NULL THEN title ELSE v_title END, edited_at = now(), updated_at = now()
      WHERE id = p_id;
  ELSE
    UPDATE public.forum_posts SET body = v_body, edited_at = now() WHERE id = p_id;
  END IF;
END;
$$;

-- p_action: 'close' | 'reopen' (thread author or admin),
--           'delete' (author or admin; hides the thread or reply),
--           'hide' | 'restore' | 'pin' | 'unpin' (admin only),
--           'purge' (admin only; removes the row for good, a thread with its replies).
CREATE OR REPLACE FUNCTION public.forum_moderate(p_kind text, p_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean := public.forum_is_admin();
  v_author uuid;
  v_thread uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'thread' THEN
    SELECT author_id, id INTO v_author, v_thread FROM public.forum_threads WHERE id = p_id;
  ELSIF p_kind = 'post' THEN
    SELECT author_id, thread_id INTO v_author, v_thread FROM public.forum_posts WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Unknown kind' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_action IN ('close', 'reopen', 'delete') THEN
    IF v_author IS DISTINCT FROM v_uid AND NOT v_admin THEN
      RAISE EXCEPTION 'Only the author or the platform team can do this' USING ERRCODE = '42501';
    END IF;
  ELSIF p_action IN ('hide', 'restore', 'pin', 'unpin', 'purge') THEN
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Only the platform team can do this' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023';
  END IF;

  IF p_action IN ('close', 'reopen', 'pin', 'unpin') AND p_kind <> 'thread' THEN
    RAISE EXCEPTION 'Only threads can be closed or pinned' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'purge' THEN
    IF p_kind = 'thread' THEN
      DELETE FROM public.forum_threads WHERE id = p_id;
    ELSE
      DELETE FROM public.forum_posts WHERE id = p_id;
      PERFORM public.forum_refresh_thread(v_thread);
    END IF;
    RETURN;
  END IF;

  IF p_kind = 'thread' THEN
    UPDATE public.forum_threads SET
      status = CASE p_action WHEN 'close' THEN 'closed' WHEN 'reopen' THEN 'open' ELSE status END,
      closed_at = CASE p_action WHEN 'close' THEN now() WHEN 'reopen' THEN NULL ELSE closed_at END,
      pinned = CASE p_action WHEN 'pin' THEN true WHEN 'unpin' THEN false ELSE pinned END,
      hidden = CASE WHEN p_action IN ('hide', 'delete') THEN true WHEN p_action = 'restore' THEN false ELSE hidden END,
      updated_at = now()
    WHERE id = p_id;
  ELSE
    UPDATE public.forum_posts SET
      hidden = CASE WHEN p_action IN ('hide', 'delete') THEN true WHEN p_action = 'restore' THEN false ELSE hidden END
    WHERE id = p_id;
    PERFORM public.forum_refresh_thread(v_thread);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.forum_author_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_refresh_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_create_thread(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_reply(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_edit(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_moderate(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forum_is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forum_create_thread(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_reply(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_edit(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_moderate(text, uuid, text) TO authenticated;
