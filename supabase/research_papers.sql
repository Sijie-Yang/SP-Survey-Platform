-- Research paper library (admin-only)
-- Run in Supabase SQL Editor before using Admin → 论文库.
-- Requires public.is_platform_admin() from supabase/admin_projects_rls.sql.

-- ── research_papers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.research_papers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doi               TEXT,
  title             TEXT NOT NULL,
  authors           JSONB DEFAULT '[]'::jsonb,
  year              INTEGER,
  abstract          TEXT,
  venue             TEXT,
  paper_url         TEXT,
  s2_paper_id       TEXT,
  crossref_doi      TEXT,
  keywords          TEXT[] DEFAULT '{}',
  relevance_score   REAL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'candidate'
                    CHECK (status IN ('candidate', 'approved', 'rejected', 'archived')),
  template_fit      TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (template_fit IN ('unknown', 'likely', 'unlikely')),
  template_id       TEXT,
  sources           TEXT[] DEFAULT '{}',
  raw_meta          JSONB DEFAULT '{}'::jsonb,
  analysis_meta     JSONB NOT NULL DEFAULT '{}'::jsonb,
  scan_id           UUID,
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive for existing deployments created before analysis_meta existed.
ALTER TABLE public.research_papers
  ADD COLUMN IF NOT EXISTS analysis_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.research_papers.analysis_meta IS
  'Rule-extracted public analytics tags (perception, imagery, scale, survey, sample size).';

CREATE UNIQUE INDEX IF NOT EXISTS research_papers_doi_unique
  ON public.research_papers (lower(doi))
  WHERE doi IS NOT NULL AND doi <> '';

CREATE INDEX IF NOT EXISTS research_papers_status_idx
  ON public.research_papers (status);

CREATE INDEX IF NOT EXISTS research_papers_year_idx
  ON public.research_papers (year DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS research_papers_relevance_idx
  ON public.research_papers (relevance_score DESC);

COMMENT ON TABLE public.research_papers IS
  'Urban perception literature candidates and approved paper library (admin).';

-- ── research_paper_scans ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.research_paper_scans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query             TEXT NOT NULL,
  preset            TEXT,
  year_from         INTEGER,
  year_to           INTEGER,
  mode              TEXT DEFAULT 'latest'
                    CHECK (mode IN ('latest', 'classic', 'custom')),
  hit_count         INTEGER DEFAULT 0,
  sources_used      TEXT[] DEFAULT '{}',
  executed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error_summary     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.research_paper_scans IS
  'Audit log for paper import / scan runs (optional; unused if no importer).';

-- Optional FK from papers → scans (additive; scans may be deleted independently)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_papers_scan_id_fkey'
  ) THEN
    ALTER TABLE public.research_papers
      ADD CONSTRAINT research_papers_scan_id_fkey
      FOREIGN KEY (scan_id) REFERENCES public.research_paper_scans(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── RLS: platform admins only ────────────────────────────────────────────────
ALTER TABLE public.research_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_paper_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage research_papers" ON public.research_papers;
CREATE POLICY "Admins manage research_papers" ON public.research_papers
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Public homepage /papers: anyone can read approved library rows (no writes).
DROP POLICY IF EXISTS "Public read approved research_papers" ON public.research_papers;
CREATE POLICY "Public read approved research_papers" ON public.research_papers
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

DROP POLICY IF EXISTS "Admins manage research_paper_scans" ON public.research_paper_scans;
CREATE POLICY "Admins manage research_paper_scans" ON public.research_paper_scans
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
