-- Platform news / announcements (public read + admin CRUD)
-- Run in Supabase SQL Editor before using Admin → News and /news.
-- Requires public.is_platform_admin() from supabase/admin_projects_rls.sql.

CREATE TABLE IF NOT EXISTS public.news_posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL,
  title_en       TEXT NOT NULL,
  title_zh       TEXT,
  summary_en     TEXT,
  summary_zh     TEXT,
  body_en        TEXT NOT NULL DEFAULT '',
  body_zh        TEXT,
  cover_url      TEXT,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published', 'archived')),
  published_at   TIMESTAMPTZ,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS news_posts_slug_unique
  ON public.news_posts (lower(slug));

CREATE INDEX IF NOT EXISTS news_posts_status_published_idx
  ON public.news_posts (status, published_at DESC NULLS LAST);

COMMENT ON TABLE public.news_posts IS
  'Public site news posts; admins write, anon/auth read published rows.';

ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage news_posts" ON public.news_posts;
CREATE POLICY "Admins manage news_posts" ON public.news_posts
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Public read published news_posts" ON public.news_posts;
CREATE POLICY "Public read published news_posts" ON public.news_posts
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');
