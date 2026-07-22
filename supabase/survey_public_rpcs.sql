-- Public survey RPCs referenced by the SPA.
-- Additive and idempotent. Participant links always load the latest project
-- (draft/live), not a published snapshot. "Publish" in the product means
-- Live Surveys homepage listing, not gating the share URL.
-- DROP first: CREATE OR REPLACE cannot change a function's return type.

DROP FUNCTION IF EXISTS public.get_survey_project(TEXT);
DROP FUNCTION IF EXISTS public.count_responses(TEXT);
DROP FUNCTION IF EXISTS public.get_pair_stats(TEXT);

-- Embed only the frozen Skill revisions referenced by this survey. Stored drafts
-- remain free of skillHtml; public participants never need Skill-library RLS.
CREATE OR REPLACE FUNCTION public.hydrate_survey_skill_html(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB := COALESCE(p_config, '{}'::jsonb);
  v_pages JSONB := '[]'::jsonb;
  v_elements JSONB;
  v_page JSONB;
  v_element JSONB;
  v_html TEXT;
  v_revision INTEGER;
BEGIN
  IF jsonb_typeof(v_result->'pages') <> 'array' THEN
    RETURN v_result;
  END IF;

  FOR v_page IN SELECT value FROM jsonb_array_elements(v_result->'pages') LOOP
    v_elements := '[]'::jsonb;
    FOR v_element IN SELECT value FROM jsonb_array_elements(COALESCE(v_page->'elements', '[]'::jsonb)) LOOP
      IF v_element->>'type' = 'skillquestion'
         AND COALESCE(v_element->>'skillId', '') <> ''
         AND v_element->>'skillId' NOT LIKE 'preset\_%' ESCAPE '\' THEN
        v_html := NULL;
        v_revision := CASE
          WHEN COALESCE(v_element->>'skillRevision', '') ~ '^[0-9]+$'
            THEN (v_element->>'skillRevision')::integer
          ELSE NULL
        END;

        IF to_regclass('public.question_skill_versions') IS NOT NULL AND v_revision IS NOT NULL THEN
          SELECT source_html
          INTO v_html
          FROM public.question_skill_versions
          WHERE skill_id = v_element->>'skillId' AND revision = v_revision;
        END IF;

        -- Legacy questions without a frozen revision keep their historical current-row fallback.
        IF v_html IS NULL THEN
          SELECT source_html
          INTO v_html
          FROM public.question_skills
          WHERE id = v_element->>'skillId';
        END IF;

        IF v_html IS NOT NULL THEN
          v_element := v_element || jsonb_build_object('skillHtml', v_html);
        END IF;
      END IF;
      v_elements := v_elements || jsonb_build_array(v_element);
    END LOOP;
    v_pages := v_pages || jsonb_build_array(v_page || jsonb_build_object('elements', v_elements));
  END LOOP;
  RETURN jsonb_set(v_result, '{pages}', v_pages, true);
END;
$$;

REVOKE ALL ON FUNCTION public.hydrate_survey_skill_html(JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_survey_project(p_id TEXT)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  description TEXT,
  survey_config JSONB,
  image_dataset_config JSONB,
  preloaded_images JSONB,
  preloaded_at TIMESTAMPTZ,
  preloaded_source TEXT,
  template_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.description,
    public.hydrate_survey_skill_html(COALESCE(p.survey_config_draft, p.survey_config)) AS survey_config,
    -- Strip credential-bearing keys from public image dataset config
    (
      COALESCE(p.image_dataset_config, '{}'::jsonb)
      - 'huggingFaceToken'
      - 'falApiKey'
      - 'falKey'
      - 'supabaseKey'
      - 'supabaseAnonKey'
      - 'openaiApiKey'
      - 'apiKey'
    ) AS image_dataset_config,
    p.preloaded_images,
    p.preloaded_at,
    p.preloaded_source,
    p.template_id
  FROM public.projects p
  WHERE p.id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_survey_project(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_responses(p_project_id TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.survey_responses
  WHERE project_id = p_project_id;
$$;

GRANT EXECUTE ON FUNCTION public.count_responses(TEXT) TO anon, authenticated;

-- Pairwise / TrueSkill helper used by adaptive media (minimal stub if table exists)
CREATE OR REPLACE FUNCTION public.get_pair_stats(p_project_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Return empty stats if the detailed pair table is not present.
  IF to_regclass('public.survey_pair_stats') IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(s))
      FROM public.survey_pair_stats s
      WHERE s.project_id = p_project_id
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pair_stats(TEXT) TO anon, authenticated;
