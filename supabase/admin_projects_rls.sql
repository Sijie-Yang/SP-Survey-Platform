-- Admin RLS for projects (run in Supabase SQL Editor)
--
-- Symptom fixed:
--   Admin Dashboard → "修复重复ID" / updateProjectAdmin fails with:
--   "没有更新到任何项目行（可能是管理员 RLS 未允许更新他人项目）"
--
-- Cause:
--   projects RLS only allows auth.uid() = user_id (owner).
--   Admins can often SELECT all rows (separate policy) but cannot UPDATE others'.
--
-- After running this SQL:
--   1. Insert your admin user into public.admins (see bottom)
--   2. Retry 修复重复ID

-- ── 1) Admins registry ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Users can read their own admin row (enough for checkIsAdmin()).
-- Full admin listing uses is_platform_admin() (SECURITY DEFINER).
DROP POLICY IF EXISTS "Admins read admins" ON public.admins;
DROP POLICY IF EXISTS "Users read own admin row" ON public.admins;
CREATE POLICY "Users read own admin row" ON public.admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 2) Helper (SECURITY DEFINER avoids RLS recursion on admins) ───────────
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- ── 3) projects: keep owner policy, add admin full access ─────────────────
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Owner policy (idempotent recreate — safe if it already exists)
DROP POLICY IF EXISTS "Users manage their own projects" ON public.projects;
CREATE POLICY "Users manage their own projects" ON public.projects
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins select all projects" ON public.projects;
CREATE POLICY "Admins select all projects" ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins update all projects" ON public.projects;
CREATE POLICY "Admins update all projects" ON public.projects
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins delete all projects" ON public.projects;
CREATE POLICY "Admins delete all projects" ON public.projects
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- Optional: allow admins to insert on behalf of users (usually not needed)
-- DROP POLICY IF EXISTS "Admins insert projects" ON public.projects;
-- CREATE POLICY "Admins insert projects" ON public.projects
--   FOR INSERT TO authenticated
--   WITH CHECK (public.is_platform_admin());

-- ── 4) Register yourself as admin ─────────────────────────────────────────
-- Replace the email with your login email, then run:
--
-- INSERT INTO public.admins (user_id, email)
-- SELECT id, email FROM auth.users
-- WHERE email = 'you@example.com'
-- ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;
--
-- Verify:
-- SELECT public.is_platform_admin();  -- should be true while logged in as that user
-- SELECT * FROM public.admins;
