-- Landing card cover for templates (picked from template media library).
ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

COMMENT ON COLUMN public.templates.thumbnail_url IS
  'Public image URL used as the landing-page template card cover.';
