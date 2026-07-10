-- Spatial Intelligence (run in Supabase SQL editor)
--
-- Features (L0 / Seg) now live on Cloudflare R2 as CSV:
--   {userId}/{projectId}/features/{model}.csv
--   templates/{templateId}/features/{model}.csv
-- Do NOT store feature blobs in projects.image_dataset_config anymore.
--
-- KEEP: user_spatial_settings (HF / fal keys + SAM toggle, cross-device)
-- OPTIONAL / LEGACY (safe to drop if you created them earlier and no longer need them):

-- DROP TABLE IF EXISTS image_features CASCADE;
-- DROP TABLE IF EXISTS media_assets CASCADE;
-- DROP TABLE IF EXISTS user_inference_credentials CASCADE;
--
-- Also optional: strip old JSON feature blobs from projects (does not delete images):
-- UPDATE projects
-- SET image_dataset_config = image_dataset_config - 'imageFeatures'
-- WHERE image_dataset_config ? 'imageFeatures';

-- Cross-device Spatial Intelligence settings (API keys + SAM toggle) — KEEP THIS
CREATE TABLE IF NOT EXISTS user_spatial_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE user_spatial_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own spatial settings" ON user_spatial_settings;
CREATE POLICY "Users manage own spatial settings" ON user_spatial_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Legacy tables (no longer used by the app; create only if you still want them) ──
-- Uncomment only if you need a temporary bridge; otherwise prefer DROP above.

-- CREATE TABLE IF NOT EXISTS media_assets (...);
-- CREATE TABLE IF NOT EXISTS image_features (...);
-- CREATE TABLE IF NOT EXISTS user_inference_credentials (...);
