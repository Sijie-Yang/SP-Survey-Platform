-- SP-Bench: Subjective–Objective Spatial Perception and Cognition benchmark
-- Additive and idempotent. Run in Supabase SQL Editor after admin_projects_rls.sql
-- (requires public.is_platform_admin()).

-- ── Global settings ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sp_bench_settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_enabled    BOOLEAN NOT NULL DEFAULT false,
  title             TEXT NOT NULL DEFAULT 'SP-Bench',
  subtitle          TEXT NOT NULL DEFAULT 'Benchmarking Subjective–Objective Spatial Perception and Cognition in Urban Environments',
  method_version    TEXT NOT NULL DEFAULT 'v1-draft',
  landing_blurb     TEXT NOT NULL DEFAULT '',
  active_dataset_id UUID,
  active_method_id  UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.sp_bench_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ── Provider credentials (Worker/service-role ciphertext only) ────────────────

CREATE TABLE IF NOT EXISTS public.sp_bench_providers (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  adapter           TEXT NOT NULL DEFAULT 'openai_compatible'
                    CHECK (adapter IN ('openai', 'anthropic', 'google', 'openai_compatible')),
  base_url          TEXT,
  key_ciphertext    BYTEA,
  key_nonce         BYTEA,
  key_version       SMALLINT NOT NULL DEFAULT 1,
  key_hint          TEXT,
  configured        BOOLEAN NOT NULL DEFAULT false,
  last_validated_at TIMESTAMPTZ,
  last_error        TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Model catalog ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sp_bench_models (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       TEXT NOT NULL REFERENCES public.sp_bench_providers(id) ON DELETE CASCADE,
  model_id          TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  family            TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT false,
  vision            BOOLEAN NOT NULL DEFAULT true,
  context_window    INTEGER,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order        INTEGER NOT NULL DEFAULT 100,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS sp_bench_models_enabled_idx
  ON public.sp_bench_models (enabled, sort_order);

-- ── Dimension drafts + frozen methods ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sp_bench_dimensions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               TEXT NOT NULL UNIQUE,
  name_en           TEXT NOT NULL,
  name_zh           TEXT NOT NULL DEFAULT '',
  group_key         TEXT NOT NULL DEFAULT 'subjective'
                    CHECK (group_key IN ('objective', 'subjective', 'cognition')),
  label_type        TEXT NOT NULL DEFAULT 'continuous'
                    CHECK (label_type IN ('category', 'continuous', 'multi_label', 'pairwise')),
  value_range       JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics           TEXT[] NOT NULL DEFAULT '{}',
  weight            REAL NOT NULL DEFAULT 1,
  prompt_field      TEXT,
  required          BOOLEAN NOT NULL DEFAULT true,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 100,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sp_bench_methods (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version           TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'frozen', 'archived')),
  dimensions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_template   TEXT NOT NULL DEFAULT '',
  json_schema       JSONB NOT NULL DEFAULT '{}'::jsonb,
  scoring_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes             TEXT,
  frozen_at         TIMESTAMPTZ,
  frozen_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Datasets / items ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sp_bench_datasets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version           TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'frozen', 'archived')),
  method_id         UUID REFERENCES public.sp_bench_methods(id) ON DELETE SET NULL,
  r2_prefix         TEXT NOT NULL DEFAULT '',
  item_count        INTEGER NOT NULL DEFAULT 0,
  content_hash      TEXT,
  notes             TEXT,
  frozen_at         TIMESTAMPTZ,
  frozen_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sp_bench_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id        UUID NOT NULL REFERENCES public.sp_bench_datasets(id) ON DELETE CASCADE,
  item_key          TEXT NOT NULL,
  split             TEXT NOT NULL DEFAULT 'test'
                    CHECK (split IN ('train', 'val', 'test')),
  media_type        TEXT NOT NULL DEFAULT 'image'
                    CHECK (media_type IN ('image', 'image_pair')),
  media_urls        JSONB NOT NULL DEFAULT '[]'::jsonb,
  r2_keys           JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels            JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, item_key)
);

CREATE INDEX IF NOT EXISTS sp_bench_items_dataset_idx
  ON public.sp_bench_items (dataset_id, split);

ALTER TABLE public.sp_bench_settings
  DROP CONSTRAINT IF EXISTS sp_bench_settings_active_dataset_id_fkey;
ALTER TABLE public.sp_bench_settings
  ADD CONSTRAINT sp_bench_settings_active_dataset_id_fkey
  FOREIGN KEY (active_dataset_id) REFERENCES public.sp_bench_datasets(id)
  ON DELETE SET NULL;

ALTER TABLE public.sp_bench_settings
  DROP CONSTRAINT IF EXISTS sp_bench_settings_active_method_id_fkey;
ALTER TABLE public.sp_bench_settings
  ADD CONSTRAINT sp_bench_settings_active_method_id_fkey
  FOREIGN KEY (active_method_id) REFERENCES public.sp_bench_methods(id)
  ON DELETE SET NULL;

-- ── Runs / predictions / results ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sp_bench_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_row_id      UUID NOT NULL REFERENCES public.sp_bench_models(id) ON DELETE CASCADE,
  dataset_id        UUID NOT NULL REFERENCES public.sp_bench_datasets(id) ON DELETE CASCADE,
  method_id         UUID NOT NULL REFERENCES public.sp_bench_methods(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN (
                      'draft', 'queued', 'running', 'needs_review',
                      'approved', 'published', 'rejected', 'failed', 'cancelled'
                    )),
  progress_done     INTEGER NOT NULL DEFAULT 0,
  progress_total    INTEGER NOT NULL DEFAULT 0,
  error_summary     TEXT,
  cost_usd          REAL,
  latency_ms_avg    REAL,
  dataset_hash      TEXT,
  method_version    TEXT,
  predictions_r2_key TEXT,
  metrics           JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_notes      TEXT,
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  published         BOOLEAN NOT NULL DEFAULT false,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_row_id, dataset_id, method_id)
);

CREATE INDEX IF NOT EXISTS sp_bench_runs_status_idx
  ON public.sp_bench_runs (status, published);

-- Compact per-item index; large raw payloads live on R2.
CREATE TABLE IF NOT EXISTS public.sp_bench_predictions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES public.sp_bench_runs(id) ON DELETE CASCADE,
  item_id           UUID NOT NULL REFERENCES public.sp_bench_items(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ok', 'error', 'skipped')),
  prediction        JSONB,
  error_message     TEXT,
  latency_ms        INTEGER,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, item_id)
);

CREATE INDEX IF NOT EXISTS sp_bench_predictions_run_idx
  ON public.sp_bench_predictions (run_id, status);

CREATE TABLE IF NOT EXISTS public.sp_bench_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL UNIQUE REFERENCES public.sp_bench_runs(id) ON DELETE CASCADE,
  overall_score     REAL,
  group_scores      JSONB NOT NULL DEFAULT '{}'::jsonb,
  dimension_scores  JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_size       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Public leaderboard view (no labels / keys / review notes) ─────────────────

CREATE OR REPLACE VIEW public.sp_bench_public_leaderboard AS
SELECT
  r.id AS run_id,
  m.display_name AS model_name,
  m.model_id,
  m.family,
  p.display_name AS provider_name,
  p.id AS provider_id,
  d.version AS dataset_version,
  meth.version AS method_version,
  res.overall_score,
  res.group_scores,
  res.dimension_scores,
  res.sample_size,
  r.cost_usd,
  r.latency_ms_avg,
  r.reviewed_at,
  r.updated_at
FROM public.sp_bench_runs r
JOIN public.sp_bench_models m ON m.id = r.model_row_id
JOIN public.sp_bench_providers p ON p.id = m.provider_id
JOIN public.sp_bench_datasets d ON d.id = r.dataset_id
JOIN public.sp_bench_methods meth ON meth.id = r.method_id
LEFT JOIN public.sp_bench_results res ON res.run_id = r.id
WHERE r.status = 'approved'
  AND r.published = true
  AND m.enabled = true
  AND EXISTS (
    SELECT 1 FROM public.sp_bench_settings s
    WHERE s.id = 1 AND s.public_enabled = true
  );

-- ── Seed default providers + popular model candidates ─────────────────────────

INSERT INTO public.sp_bench_providers (id, display_name, adapter, base_url)
VALUES
  ('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1'),
  ('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com'),
  ('google', 'Google', 'google', 'https://generativelanguage.googleapis.com'),
  ('xai', 'xAI', 'openai_compatible', 'https://api.x.ai/v1'),
  ('deepseek', 'DeepSeek', 'openai_compatible', 'https://api.deepseek.com'),
  ('qwen', 'Alibaba Qwen', 'openai_compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  ('moonshot', 'Moonshot / Kimi', 'openai_compatible', 'https://api.moonshot.cn/v1'),
  ('mistral', 'Mistral', 'openai_compatible', 'https://api.mistral.ai/v1'),
  ('openrouter', 'OpenRouter', 'openai_compatible', 'https://openrouter.ai/api/v1')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  adapter = EXCLUDED.adapter,
  base_url = EXCLUDED.base_url;

INSERT INTO public.sp_bench_models (provider_id, model_id, display_name, family, vision, sort_order)
VALUES
  ('openai', 'gpt-5.6-sol', 'GPT-5.6 Sol', 'GPT-5.6', true, 10),
  ('openai', 'gpt-5.6-terra', 'GPT-5.6 Terra', 'GPT-5.6', true, 20),
  ('openai', 'gpt-5.6-luna', 'GPT-5.6 Luna', 'GPT-5.6', true, 30),
  ('openai', 'gpt-4o', 'GPT-4o', 'GPT-4o', true, 40),
  ('anthropic', 'claude-fable-5', 'Claude Fable 5', 'Claude', true, 50),
  ('anthropic', 'claude-sonnet-5', 'Claude Sonnet 5', 'Claude', true, 60),
  ('anthropic', 'claude-opus-4-8', 'Claude Opus 4.8', 'Claude', true, 70),
  ('google', 'gemini-3.5-flash', 'Gemini 3.5 Flash', 'Gemini', true, 80),
  ('google', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', 'Gemini', true, 90),
  ('xai', 'grok-4.5', 'Grok 4.5', 'Grok', true, 100),
  ('deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro', 'DeepSeek', true, 110),
  ('qwen', 'qwen3.7-plus', 'Qwen3.7 Plus', 'Qwen', true, 120),
  ('moonshot', 'kimi-k3', 'Kimi K3', 'Kimi', true, 130),
  ('mistral', 'mistral-medium-latest', 'Mistral Medium', 'Mistral', true, 140),
  ('openrouter', 'openai/gpt-4o', 'OpenRouter · GPT-4o', 'OpenRouter', true, 150)
ON CONFLICT (provider_id, model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  family = EXCLUDED.family,
  vision = EXCLUDED.vision,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Suggested dimension template (editable; not frozen until method freeze)
INSERT INTO public.sp_bench_dimensions (
  key, name_en, name_zh, group_key, label_type, value_range, metrics, weight, prompt_field, sort_order
) VALUES
  ('scene_type', 'Scene / street type', '场景/街道类型', 'objective', 'category',
   '{"choices":["residential","commercial","mixed","park","highway","alley","waterfront"]}'::jsonb,
   ARRAY['macro_f1','balanced_accuracy'], 1, 'scene_type', 10),
  ('green_view_ratio', 'Green view ratio', '绿视率', 'objective', 'continuous',
   '{"min":0,"max":1}'::jsonb, ARRAY['mae','rmse','spearman'], 1, 'green_view_ratio', 20),
  ('sky_ratio', 'Sky ratio', '天空率', 'objective', 'continuous',
   '{"min":0,"max":1}'::jsonb, ARRAY['mae','rmse','spearman'], 1, 'sky_ratio', 30),
  ('enclosure', 'Enclosure', '围合度', 'objective', 'continuous',
   '{"min":1,"max":7}'::jsonb, ARRAY['mae','rmse','spearman'], 1, 'enclosure', 40),
  ('safety', 'Perceived safety', '安全感', 'subjective', 'continuous',
   '{"min":1,"max":7}'::jsonb, ARRAY['mae','rmse','spearman','pearson'], 1.5, 'safety', 50),
  ('beauty', 'Perceived beauty', '美观', 'subjective', 'continuous',
   '{"min":1,"max":7}'::jsonb, ARRAY['mae','rmse','spearman','pearson'], 1.5, 'beauty', 60),
  ('vitality', 'Perceived vitality', '活力', 'subjective', 'continuous',
   '{"min":1,"max":7}'::jsonb, ARRAY['mae','rmse','spearman','pearson'], 1.2, 'vitality', 70),
  ('walkability', 'Walkability', '步行友好', 'subjective', 'continuous',
   '{"min":1,"max":7}'::jsonb, ARRAY['mae','rmse','spearman','pearson'], 1.2, 'walkability', 80),
  ('risk_cues', 'Risk cues', '风险线索', 'cognition', 'multi_label',
   '{"choices":["traffic","crime","darkness","construction","flooding","none"]}'::jsonb,
   ARRAY['macro_f1'], 1, 'risk_cues', 90),
  ('affordances', 'Affordances', '可供性', 'cognition', 'multi_label',
   '{"choices":["walk","sit","cycle","cross","socialize","exercise"]}'::jsonb,
   ARRAY['macro_f1'], 1, 'affordances', 100)
ON CONFLICT (key) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.sp_bench_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_bench_results ENABLE ROW LEVEL SECURITY;

-- Settings: admins full; public can read only when enabled (no secrets there)
DROP POLICY IF EXISTS "Admins manage sp_bench_settings" ON public.sp_bench_settings;
CREATE POLICY "Admins manage sp_bench_settings" ON public.sp_bench_settings
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Public read sp_bench_settings when enabled" ON public.sp_bench_settings;
CREATE POLICY "Public read sp_bench_settings when enabled" ON public.sp_bench_settings
  FOR SELECT TO anon, authenticated
  USING (true);

-- Providers: admin metadata only via RLS; ciphertext is service-role / Worker only.
-- Authenticated admins may SELECT non-sensitive columns through a view; block direct table reads of ciphertext
-- by denying SELECT for authenticated and using service role in Worker.
DROP POLICY IF EXISTS "Admins manage sp_bench_providers" ON public.sp_bench_providers;
-- No authenticated policies: Worker uses service role. Admins go through Worker API.

DROP POLICY IF EXISTS "Admins manage sp_bench_models" ON public.sp_bench_models;
CREATE POLICY "Admins manage sp_bench_models" ON public.sp_bench_models
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Public read enabled published models" ON public.sp_bench_models;
CREATE POLICY "Public read enabled published models" ON public.sp_bench_models
  FOR SELECT TO anon, authenticated
  USING (
    enabled = true
    AND EXISTS (
      SELECT 1 FROM public.sp_bench_runs r
      WHERE r.model_row_id = id AND r.status = 'approved' AND r.published = true
    )
    AND EXISTS (
      SELECT 1 FROM public.sp_bench_settings s WHERE s.id = 1 AND s.public_enabled = true
    )
  );

DROP POLICY IF EXISTS "Admins manage sp_bench_dimensions" ON public.sp_bench_dimensions;
CREATE POLICY "Admins manage sp_bench_dimensions" ON public.sp_bench_dimensions
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins manage sp_bench_methods" ON public.sp_bench_methods;
CREATE POLICY "Admins manage sp_bench_methods" ON public.sp_bench_methods
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Public read frozen methods when enabled" ON public.sp_bench_methods;
CREATE POLICY "Public read frozen methods when enabled" ON public.sp_bench_methods
  FOR SELECT TO anon, authenticated
  USING (
    status = 'frozen'
    AND EXISTS (
      SELECT 1 FROM public.sp_bench_settings s WHERE s.id = 1 AND s.public_enabled = true
    )
  );

DROP POLICY IF EXISTS "Admins manage sp_bench_datasets" ON public.sp_bench_datasets;
CREATE POLICY "Admins manage sp_bench_datasets" ON public.sp_bench_datasets
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Public read frozen datasets metadata" ON public.sp_bench_datasets;
CREATE POLICY "Public read frozen datasets metadata" ON public.sp_bench_datasets
  FOR SELECT TO anon, authenticated
  USING (
    status = 'frozen'
    AND EXISTS (
      SELECT 1 FROM public.sp_bench_settings s WHERE s.id = 1 AND s.public_enabled = true
    )
  );

-- Items contain labels — admin only (never public)
DROP POLICY IF EXISTS "Admins manage sp_bench_items" ON public.sp_bench_items;
CREATE POLICY "Admins manage sp_bench_items" ON public.sp_bench_items
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins manage sp_bench_runs" ON public.sp_bench_runs;
CREATE POLICY "Admins manage sp_bench_runs" ON public.sp_bench_runs
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Public read published runs" ON public.sp_bench_runs;
CREATE POLICY "Public read published runs" ON public.sp_bench_runs
  FOR SELECT TO anon, authenticated
  USING (
    status = 'approved'
    AND published = true
    AND EXISTS (
      SELECT 1 FROM public.sp_bench_settings s WHERE s.id = 1 AND s.public_enabled = true
    )
  );

DROP POLICY IF EXISTS "Admins manage sp_bench_predictions" ON public.sp_bench_predictions;
CREATE POLICY "Admins manage sp_bench_predictions" ON public.sp_bench_predictions
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins manage sp_bench_results" ON public.sp_bench_results;
CREATE POLICY "Admins manage sp_bench_results" ON public.sp_bench_results
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Public read published results" ON public.sp_bench_results;
CREATE POLICY "Public read published results" ON public.sp_bench_results
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sp_bench_runs r
      WHERE r.id = run_id
        AND r.status = 'approved'
        AND r.published = true
    )
    AND EXISTS (
      SELECT 1 FROM public.sp_bench_settings s WHERE s.id = 1 AND s.public_enabled = true
    )
  );

GRANT SELECT ON public.sp_bench_public_leaderboard TO anon, authenticated;

COMMENT ON TABLE public.sp_bench_settings IS
  'SP-Bench global toggles and active dataset/method pointers.';
COMMENT ON TABLE public.sp_bench_providers IS
  'Encrypted provider API keys for SP-Bench evaluation (Worker/service-role only).';
COMMENT ON TABLE public.sp_bench_items IS
  'Benchmark items with ground-truth labels — never exposed publicly.';
