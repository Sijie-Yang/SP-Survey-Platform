-- Immutable revisions and result contracts for custom question skills.
-- Apply after the base question_skills table exists.

alter table if exists public.question_skills
  add column if not exists current_revision integer not null default 1,
  add column if not exists contract_version integer not null default 0,
  add column if not exists example_answer jsonb;

create table if not exists public.question_skill_versions (
  skill_id text not null references public.question_skills(id) on delete cascade,
  revision integer not null check (revision > 0),
  user_id uuid,
  name text not null default '',
  description text not null default '',
  source_html text not null,
  analysis_html text not null default '',
  config_schema jsonb not null default '[]'::jsonb,
  default_config jsonb not null default '{}'::jsonb,
  result_schema jsonb not null default '[]'::jsonb,
  example_answer jsonb,
  contract_version integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (skill_id, revision)
);

create index if not exists question_skill_versions_user_idx
  on public.question_skill_versions(user_id, created_at desc);

alter table public.question_skill_versions enable row level security;

drop policy if exists "Owners read own skill revisions" on public.question_skill_versions;
create policy "Owners read own skill revisions" on public.question_skill_versions
  for select using (user_id = auth.uid());

drop policy if exists "Read approved skill revisions" on public.question_skill_versions;
create policy "Read approved skill revisions" on public.question_skill_versions
  for select using (
    exists (
      select 1 from public.question_skills s
      where s.id = skill_id and s.is_approved = true
    )
  );

drop policy if exists "Owners insert skill revisions" on public.question_skill_versions;
create policy "Owners insert skill revisions" on public.question_skill_versions
  for insert with check (user_id = auth.uid());

-- Backfill the current mutable row as revision 1. Safe to rerun.
insert into public.question_skill_versions (
  skill_id, revision, user_id, name, description, source_html, analysis_html,
  config_schema, default_config, result_schema, example_answer, contract_version,
  created_at
)
select
  id, 1, user_id, coalesce(name, ''), coalesce(description, ''), source_html,
  coalesce(analysis_html, ''), coalesce(config_schema, '[]'::jsonb),
  coalesce(default_config, '{}'::jsonb), coalesce(result_schema, '[]'::jsonb),
  example_answer, contract_version, coalesce(created_at, now())
from public.question_skills
on conflict (skill_id, revision) do nothing;

comment on table public.question_skill_versions is
  'Immutable source, analysis, configuration, and result contract revisions for skillquestion.';
