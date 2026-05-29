alter table public.certificates
  add column if not exists course_title_snapshot text,
  add column if not exists organization_name_snapshot text,
  add column if not exists organization_slug_snapshot text,
  add column if not exists user_full_name_snapshot text,
  add column if not exists user_email_snapshot text,
  add column if not exists certificate_title_snapshot text;

update public.certificates c
set
  course_title_snapshot = coalesce(
    nullif(btrim(c.course_title_snapshot), ''),
    (
      select nullif(btrim(co.title), '')
      from public.courses co
      where co.id = c.course_id
    ),
    'Untitled course'
  ),
  organization_name_snapshot = coalesce(
    nullif(btrim(c.organization_name_snapshot), ''),
    (
      select nullif(btrim(o.name), '')
      from public.organizations o
      where o.id = c.organization_id
    ),
    (
      select nullif(btrim(o.slug), '')
      from public.organizations o
      where o.id = c.organization_id
    )
  ),
  organization_slug_snapshot = coalesce(
    nullif(btrim(c.organization_slug_snapshot), ''),
    (
      select nullif(btrim(o.slug), '')
      from public.organizations o
      where o.id = c.organization_id
    )
  ),
  user_full_name_snapshot = coalesce(
    nullif(btrim(c.user_full_name_snapshot), ''),
    (
      select nullif(btrim(u.full_name), '')
      from public.users u
      where u.id = c.user_id
    )
  ),
  user_email_snapshot = coalesce(
    nullif(btrim(c.user_email_snapshot), ''),
    (
      select nullif(btrim(u.email), '')
      from public.users u
      where u.id = c.user_id
    )
  ),
  certificate_title_snapshot = coalesce(
    nullif(btrim(c.certificate_title_snapshot), ''),
    (
      select nullif(btrim(s.certificate_title), '')
      from public.course_certificate_settings s
      where s.course_id = c.course_id
    ),
    'Certificate'
  );

alter table public.certificates
  drop constraint if exists certificates_course_id_fkey;

alter table public.certificates
  alter column course_id drop not null;

alter table public.certificates
  add constraint certificates_course_id_fkey
  foreign key (course_id)
  references public.courses(id)
  on delete set null;

create index if not exists certificates_course_id_idx
  on public.certificates(course_id);
