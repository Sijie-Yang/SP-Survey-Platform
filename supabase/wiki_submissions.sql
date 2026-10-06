-- SP-Wiki and moderated Doc / News submissions.
-- Prerequisites: admin_projects_rls.sql (is_platform_admin), news_posts.sql.
-- Apply through the normal database migration workflow. No service-role client is needed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.wiki_builtin_pages (
  page_key text PRIMARY KEY,
  is_template boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.wiki_pages (
  page_key text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','zh')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL,
  template_id text,
  contributor_name text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_key, language)
);
CREATE TABLE IF NOT EXISTS public.content_submissions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN ('doc_edit','doc_new','news')),
  target_key text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','zh')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 20 AND 80000),
  contributor_name text NOT NULL CHECK (length(btrim(contributor_name)) BETWEEN 2 AND 100),
  change_reason text NOT NULL CHECK (length(btrim(change_reason)) BETWEEN 10 AND 2000),
  source_notes text NOT NULL DEFAULT '' CHECK (length(source_notes) <= 5000),
  template_id text,
  rights_confirmed boolean NOT NULL CHECK (rights_confirmed),
  base_revision integer NOT NULL DEFAULT 0 CHECK (base_revision >= 0),
  base_content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(base_content::text) <= 400000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','changes_requested','rejected','approved')),
  version integer NOT NULL DEFAULT 1,
  review_note text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  published_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_submissions_owner_idx ON public.content_submissions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS content_submissions_queue_idx ON public.content_submissions(status, updated_at DESC);
CREATE TABLE IF NOT EXISTS public.content_submission_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.content_submissions(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.wiki_page_revisions (
  page_key text NOT NULL,
  language text NOT NULL,
  revision integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  contributor_name text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(page_key,language,revision)
);
CREATE INDEX IF NOT EXISTS content_submission_events_submission_idx ON public.content_submission_events(submission_id,created_at DESC);
ALTER TABLE public.news_posts ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'plain';
ALTER TABLE public.news_posts ADD COLUMN IF NOT EXISTS contributor_name text;

ALTER TABLE public.wiki_builtin_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_page_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_submission_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Wiki public pages" ON public.wiki_pages;
CREATE POLICY "Wiki public pages" ON public.wiki_pages FOR SELECT TO anon,authenticated USING (true);
DROP POLICY IF EXISTS "Wiki public history" ON public.wiki_page_revisions;
CREATE POLICY "Wiki public history" ON public.wiki_page_revisions FOR SELECT TO anon,authenticated USING (true);
DROP POLICY IF EXISTS "Own submissions or admin" ON public.content_submissions;
CREATE POLICY "Own submissions or admin" ON public.content_submissions FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Own submission events or admin" ON public.content_submission_events;
CREATE POLICY "Own submission events or admin" ON public.content_submission_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.content_submissions s WHERE s.id=submission_id AND (s.user_id=auth.uid() OR public.is_platform_admin()))
);
-- Mutation is only possible through the validated RPCs below, including for administrators.
REVOKE ALL ON public.wiki_builtin_pages, public.wiki_pages, public.wiki_page_revisions, public.content_submissions, public.content_submission_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wiki_pages,public.wiki_page_revisions TO anon,authenticated;
GRANT SELECT ON public.content_submissions,public.content_submission_events TO authenticated;

CREATE OR REPLACE FUNCTION public.save_content_submission(p_id uuid, p_expected_version integer, p_input jsonb)
RETURNS public.content_submissions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old public.content_submissions; result public.content_submissions; live public.wiki_pages;
  target text; kind text:=p_input->>'kind'; lang text:=p_input->>'language'; base integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to submit' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL OR kind IS NULL OR lang IS NULL OR kind NOT IN ('doc_edit','doc_new','news') OR lang NOT IN ('en','zh') THEN RAISE EXCEPTION 'Invalid submission'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  -- Serialize creation by ID too: a conflicting INSERT must never bypass ownership checks.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,2));
  SELECT * INTO old FROM public.content_submissions WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
    IF old.user_id<>auth.uid() THEN RAISE EXCEPTION 'Not your submission' USING ERRCODE='42501'; END IF;
    IF old.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Submission changed; reload before saving' USING ERRCODE='40001'; END IF;
    IF old.status='approved' THEN RAISE EXCEPTION 'Published submissions are immutable; propose a new edit'; END IF;
    IF old.kind<>kind OR old.language<>lang THEN RAISE EXCEPTION 'Submission type and language cannot change'; END IF;
  ELSE
    IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Submission no longer exists' USING ERRCODE='40001'; END IF;
    IF (SELECT count(*) FROM public.content_submissions WHERE user_id=auth.uid() AND status IN ('pending','changes_requested')) >= 20 THEN RAISE EXCEPTION 'Please resolve existing submissions before adding more'; END IF;
  END IF;
  target:=CASE WHEN kind='doc_edit' THEN p_input->>'target_key' ELSE 'community-'||p_id::text END;
  IF old.id IS NOT NULL AND old.target_key IS DISTINCT FROM target THEN RAISE EXCEPTION 'Target cannot change'; END IF;
  IF kind='doc_edit' AND NOT EXISTS (SELECT 1 FROM public.wiki_builtin_pages WHERE page_key=target) AND NOT EXISTS (SELECT 1 FROM public.wiki_pages WHERE page_key=target AND language=lang) THEN RAISE EXCEPTION 'Unknown document'; END IF;
  IF nullif(p_input->>'template_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wiki_builtin_pages WHERE page_key=p_input->>'template_id' AND is_template) THEN RAISE EXCEPTION 'Unknown template'; END IF;
  SELECT * INTO live FROM public.wiki_pages WHERE page_key=target AND language=lang;
  base:=CASE WHEN kind='doc_edit' THEN coalesce((p_input->>'base_revision')::integer,0) ELSE 0 END;
  IF kind='doc_edit' AND base<>coalesce(live.revision,0) THEN RAISE EXCEPTION 'Document changed; reload its current revision' USING ERRCODE='40001'; END IF;
  INSERT INTO public.content_submissions(id,user_id,kind,target_key,language,title,summary,body,contributor_name,change_reason,source_notes,template_id,rights_confirmed,base_revision,base_content)
  VALUES(p_id,auth.uid(),kind,target,lang,btrim(p_input->>'title'),coalesce(p_input->>'summary',''),p_input->>'body',btrim(p_input->>'contributor_name'),btrim(p_input->>'change_reason'),coalesce(p_input->>'source_notes',''),nullif(p_input->>'template_id',''),coalesce((p_input->>'rights_confirmed')::boolean,false),base,
    CASE WHEN live.page_key IS NOT NULL THEN jsonb_build_object('title',live.title,'summary',live.summary,'body',live.body) ELSE coalesce(p_input->'base_content','{}') END)
  ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,body=EXCLUDED.body,contributor_name=EXCLUDED.contributor_name,change_reason=EXCLUDED.change_reason,source_notes=EXCLUDED.source_notes,template_id=EXCLUDED.template_id,rights_confirmed=EXCLUDED.rights_confirmed,base_revision=EXCLUDED.base_revision,base_content=EXCLUDED.base_content,status='pending',version=content_submissions.version+1,review_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
  RETURNING * INTO result;
  INSERT INTO public.content_submission_events(submission_id,actor_id,action,snapshot) VALUES(p_id,auth.uid(),'submitted',to_jsonb(result));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.review_content_submission(p_id uuid,p_expected_version integer,p_decision text,p_note text DEFAULT '')
RETURNS public.content_submissions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.content_submissions; live public.wiki_pages; next_revision integer; target_url text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_platform_admin(),false) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','changes_requested','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF length(coalesce(p_note,''))>4000 OR (p_decision<>'approved' AND length(btrim(coalesce(p_note,'')))<3) THEN RAISE EXCEPTION 'Please provide review feedback (up to 4000 characters)'; END IF;
  SELECT * INTO item FROM public.content_submissions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submission not found'; END IF;
  IF item.version IS DISTINCT FROM p_expected_version OR item.status<>'pending' THEN RAISE EXCEPTION 'Submission changed; reload before reviewing' USING ERRCODE='40001'; END IF;
  IF p_decision='approved' THEN
    IF item.kind IN ('doc_edit','doc_new') THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(item.target_key||':'||item.language,1));
      SELECT * INTO live FROM public.wiki_pages WHERE page_key=item.target_key AND language=item.language FOR UPDATE;
      IF coalesce(live.revision,0)<>item.base_revision THEN RAISE EXCEPTION 'Document changed since submission; return for revision' USING ERRCODE='40001'; END IF;
      next_revision:=coalesce(live.revision,0)+1;
      INSERT INTO public.wiki_pages(page_key,language,title,summary,body,template_id,contributor_name,revision)
      VALUES(item.target_key,item.language,item.title,item.summary,item.body,item.template_id,item.contributor_name,next_revision)
      ON CONFLICT(page_key,language) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,body=EXCLUDED.body,template_id=EXCLUDED.template_id,contributor_name=EXCLUDED.contributor_name,revision=EXCLUDED.revision,updated_at=now();
      INSERT INTO public.wiki_page_revisions(page_key,language,revision,title,summary,body,contributor_name) VALUES(item.target_key,item.language,next_revision,item.title,item.summary,item.body,item.contributor_name);
      target_url:='/docs/'||item.target_key;
    ELSE
      INSERT INTO public.news_posts(slug,title_en,title_zh,summary_en,summary_zh,body_en,body_zh,status,published_at,created_by,content_format,contributor_name)
      VALUES(item.target_key,CASE WHEN item.language='en' THEN item.title ELSE '' END,CASE WHEN item.language='zh' THEN item.title END,CASE WHEN item.language='en' THEN item.summary END,CASE WHEN item.language='zh' THEN item.summary END,CASE WHEN item.language='en' THEN item.body ELSE '' END,CASE WHEN item.language='zh' THEN item.body END,'published',now(),item.user_id,'markdown',item.contributor_name);
      target_url:='/news/'||item.target_key;
    END IF;
  END IF;
  UPDATE public.content_submissions SET status=p_decision,review_note=coalesce(p_note,''),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now(),version=version+1,published_url=target_url WHERE id=p_id RETURNING * INTO item;
  INSERT INTO public.content_submission_events(submission_id,actor_id,action,snapshot) VALUES(p_id,auth.uid(),p_decision,to_jsonb(item));
  RETURN item;
END $$;
REVOKE ALL ON FUNCTION public.save_content_submission(uuid,integer,jsonb),public.review_content_submission(uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_content_submission(uuid,integer,jsonb),public.review_content_submission(uuid,integer,text,text) TO authenticated;
INSERT INTO public.wiki_builtin_pages(page_key,is_template) VALUES
('doc-news-submission',false),
('urban-spatial-perception',false),
('perception-dimensions',false),
('perception-to-measurement',false),
('visual-assessment',false),
('study-design',false),
('question-types',false),
('media-sampling',false),
('annotations-video',false),
('q-score',false),
('trueskill',false),
('choosing-analysis',false),
('quality-reliability',false),
('platform-workflow',false),
('results-export',false),
('skills-agents',false),
('1990-nasar-evaluative',true),
('2009-ewing-measuring',true),
('2013-salesses-collaborative',true),
('2014-quercia-aesthetic',true),
('2014-naik-streetscore',true),
('2016-dubey-place',true),
('2017-liu-machine',true),
('2017-seresinhe-scenic',true),
('2019-yao-human',true),
('2021-ramirez-measuring',true),
('2021-ito-assessing',true),
('2021-kruse-places',true),
('2022-qiu-subjective',true),
('2023-kang-assessing',true),
('2023-torkko-how',true),
('2024-liang-building',true),
('2025-yang-thermal',true),
('2025-gu-effective',true),
('2025-li-street',true),
('2025-quintana-specs',true),
('2025-danish-citizen',true),
('2026-quintana-greenery',true),
('2026-peng-city',true),
('2026-lopes-street-gsv',true),
('2026-kang-decoding',true),
('2027-wang-hotel-hue',true)
ON CONFLICT(page_key) DO UPDATE SET is_template=EXCLUDED.is_template;
COMMIT;
