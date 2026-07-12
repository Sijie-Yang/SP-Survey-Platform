-- Template media folder / set / category tags (safe subset of imageDatasetConfig).
-- Run in Supabase SQL Editor before relying on folder round-trip for templates.

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS image_dataset_config JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN templates.image_dataset_config IS
  'Folder layout metadata for template media: mediaFolderTags (set|category) and mediaFolders. No secrets/tokens.';
