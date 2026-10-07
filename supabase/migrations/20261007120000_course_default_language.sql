-- Applied manually to the separate dev database on 2026-10-07.
-- IF NOT EXISTS permits replay on that database. Review the target before applying elsewhere.
-- No existing RLS/auth/storage changes.
begin;
alter table public.courses
  add column if not exists default_language text not null default 'en'
  constraint courses_default_language_check check (default_language in ('en', 'sr-Latn'));
comment on column public.courses.default_language is
  'Default interface language for this course. Authored content is not translated.';
commit;
