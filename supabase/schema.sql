-- =====================================================================
--  PLATAFORMA DOCENTE IA — Esquema de base de datos (Supabase / Postgres 15+)
--  Ejecutar UNA vez en: Supabase → SQL Editor → New query → Run
--  Todo se ejecuta en una sola transacción: si algo falla, no queda nada a medias.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Utilidades
-- ---------------------------------------------------------------------
create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function public.gen_join_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O/1/I
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..7 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.subjects where join_code = v_code);
  end loop;
  return v_code;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

-- Correos autorizados como DOCENTE. Todo lo demás entra como estudiante.
create table public.teacher_allowlist (
  email      text primary key check (email = lower(trim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  full_name           text,
  avatar_url          text,
  role                text not null default 'estudiante' check (role in ('docente', 'estudiante')),
  email_notifications boolean not null default true,
  created_at          timestamptz not null default now()
);

create table public.subjects (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references public.profiles(id) on delete cascade,
  name             text not null check (char_length(trim(name)) between 3 and 120),
  code             text check (char_length(code) <= 40),
  group_name       text check (char_length(group_name) <= 40),
  semester         text not null check (char_length(trim(semester)) between 4 and 20),
  description      text check (char_length(description) <= 2000),
  join_code        text not null unique default public.gen_join_code(),
  enrollment_open  boolean not null default true,
  grade_scale      numeric(5,2) not null default 5.0 check (grade_scale in (5.0, 10.0, 100.0)),
  pass_grade       numeric(5,2) not null default 3.0,
  auto_publish     boolean not null default true,   -- publicar al estudiante la evaluación IA sin revisión previa
  exported_at      timestamptz,                     -- última descarga completa del historial
  deletion_started_at timestamptz,                  -- borrado en curso (asignatura bloqueada)
  created_at       timestamptz not null default now(),
  check (pass_grade > 0 and pass_grade <= grade_scale)
);
create index subjects_teacher_idx on public.subjects(teacher_id);

create table public.cortes (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  number          smallint not null check (number between 1 and 3),
  weight          numeric(5,2) not null check (weight between 0 and 100),          -- % del semestre
  quiz_weight     numeric(5,2) not null check (quiz_weight between 0 and 100),     -- % dentro del corte
  parcial_weight  numeric(5,2) not null check (parcial_weight between 0 and 100),
  proyecto_weight numeric(5,2) not null check (proyecto_weight between 0 and 100),
  unique (subject_id, number),
  unique (id, subject_id),
  check (quiz_weight + parcial_weight + proyecto_weight = 100)
);

create table public.enrollments (
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (subject_id, student_id)
);
create index enrollments_student_idx on public.enrollments(student_id);

create table public.activities (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  corte_id        uuid not null,
  component       text not null check (component in ('quiz', 'parcial', 'proyecto')),
  title           text not null check (char_length(trim(title)) between 3 and 150),
  instructions    text not null check (char_length(instructions) between 1 and 20000),
  rubric          text check (char_length(rubric) <= 10000),       -- criterios visibles para el estudiante
  statement_path  text,                                            -- archivo de enunciado (bucket materiales)
  statement_name  text,
  weight          numeric(6,2) not null default 1 check (weight > 0), -- peso relativo entre quizzes del mismo corte
  opens_at        timestamptz not null default now(),
  due_at          timestamptz not null,
  allow_late      boolean not null default false,
  max_submissions smallint not null default 1 check (max_submissions between 1 and 10),
  accept_text     boolean not null default true,
  accept_files    boolean not null default true,
  ai_enabled      boolean not null default true,
  published       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (corte_id, subject_id) references public.cortes(id, subject_id) on delete cascade,
  check (due_at > opens_at),
  check (accept_text or accept_files)
);
-- Parcial y proyecto: UNA sola actividad por corte. Quiz: una o varias.
create unique index activities_single_component_idx
  on public.activities(corte_id, component) where component in ('parcial', 'proyecto');
create index activities_subject_idx on public.activities(subject_id);
create index activities_due_idx on public.activities(due_at) where published;

-- Solución de referencia: PRIVADA (solo docente y agente).
create table public.activity_keys (
  activity_id        uuid primary key references public.activities(id) on delete cascade,
  reference_solution text check (char_length(reference_solution) <= 60000),
  reference_path     text,
  reference_name     text,
  grading_notes      text check (char_length(grading_notes) <= 10000), -- indicaciones privadas para el agente
  updated_at         timestamptz not null default now()
);

create table public.submissions (
  id               uuid primary key default gen_random_uuid(),
  activity_id      uuid not null references public.activities(id) on delete cascade,
  student_id       uuid not null references public.profiles(id) on delete cascade,
  content_text     text check (char_length(content_text) <= 50000),
  file_path        text,
  file_name        text,
  file_mime        text,
  file_size        bigint,
  submission_count smallint not null default 1,
  submitted_at     timestamptz not null default now(),
  is_late          boolean not null default false,
  status           text not null default 'pendiente'
                   check (status in ('pendiente', 'evaluando', 'evaluada', 'revision', 'error')),
  ai_grade         numeric(5,2),
  ai_feedback      jsonb,
  ai_model         text,
  ai_confidence    numeric(3,2),
  eval_attempts    smallint not null default 0,
  last_error       text,
  locked_at        timestamptz,
  evaluated_at     timestamptz,
  teacher_grade    numeric(5,2),
  teacher_comment  text check (char_length(teacher_comment) <= 5000),
  reviewed_at      timestamptz,
  unique (activity_id, student_id)
);
create index submissions_status_idx on public.submissions(status, submitted_at);
create index submissions_student_idx on public.submissions(student_id);

-- Registro de correos enviados (idempotencia + presupuesto diario de Gmail).
create table public.notification_log (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete cascade,
  kind        text not null,
  sent_at     timestamptz not null default now(),
  unique nulls not distinct (user_id, activity_id, kind)
);
create index notification_log_sent_idx on public.notification_log(sent_at);

-- ---------------------------------------------------------------------
-- 2. Funciones auxiliares de autorización (SECURITY DEFINER evita recursión RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'docente');
$$;

create or replace function public.owns_subject(p_subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subjects where id = p_subject and teacher_id = auth.uid());
$$;

create or replace function public.is_enrolled(p_subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments where subject_id = p_subject and student_id = auth.uid());
$$;

create or replace function public.owns_activity(p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.activities a join public.subjects s on s.id = a.subject_id
    where a.id = p_activity and s.teacher_id = auth.uid());
$$;

create or replace function public.activity_visible_to_student(p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.activities a
    join public.enrollments e on e.subject_id = a.subject_id and e.student_id = auth.uid()
    where a.id = p_activity and a.published and a.opens_at <= now());
$$;

-- ---------------------------------------------------------------------
-- 3. Disparadores
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    case when new.email_confirmed_at is not null
              and exists (select 1 from public.teacher_allowlist where email = lower(new.email))
         then 'docente' else 'estudiante' end)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Si se autoriza un docente que ya se había registrado (con correo confirmado), se promueve.
create or replace function public.handle_allowlist_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set role = 'docente'
  from auth.users u
  where u.id = p.id and p.email = new.email and u.email_confirmed_at is not null;
  return new;
end $$;

-- Si un usuario autorizado confirma su correo después de registrarse, se promueve.
create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null
     and exists (select 1 from public.teacher_allowlist where email = lower(new.email)) then
    update public.profiles set role = 'docente' where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

create trigger on_allowlist_insert
  after insert on public.teacher_allowlist
  for each row execute function public.handle_allowlist_insert();

-- Cada asignatura nace con sus 3 cortes (30/30/40; quiz 30, parcial 40, proyecto 30).
create or replace function public.handle_new_subject() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.cortes (subject_id, number, weight, quiz_weight, parcial_weight, proyecto_weight)
  values (new.id, 1, 30, 30, 40, 30),
         (new.id, 2, 30, 30, 40, 30),
         (new.id, 3, 40, 30, 40, 30);
  return new;
end $$;

create trigger on_subject_created
  after insert on public.subjects
  for each row execute function public.handle_new_subject();

-- Campos de control que el cliente no puede fijar al crear.
create or replace function public.guard_subject_insert() returns trigger
language plpgsql as $$
begin
  new.exported_at := null;
  new.deletion_started_at := null;
  new.join_code := public.gen_join_code();
  return new;
end $$;

create trigger subjects_guard_insert before insert on public.subjects
  for each row execute function public.guard_subject_insert();

-- No se puede cambiar la escala si ya hay notas (se reinterpretarían sin convertir).
create or replace function public.guard_subject_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.grade_scale <> old.grade_scale and exists (
       select 1 from public.submissions s join public.activities a on a.id = s.activity_id
       where a.subject_id = old.id and (s.ai_grade is not null or s.teacher_grade is not null)) then
    raise exception 'No puedes cambiar la escala de notas porque ya hay calificaciones registradas.';
  end if;
  return new;
end $$;

create trigger subjects_guard_update before update on public.subjects
  for each row execute function public.guard_subject_update();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger activities_touch before update on public.activities
  for each row execute function public.touch_updated_at();
create trigger activity_keys_touch before update on public.activity_keys
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. Seguridad por filas (RLS)
-- ---------------------------------------------------------------------
alter table public.teacher_allowlist enable row level security;   -- sin políticas: solo SQL/servicio
alter table public.profiles          enable row level security;
alter table public.subjects          enable row level security;
alter table public.cortes            enable row level security;
alter table public.enrollments       enable row level security;
alter table public.activities        enable row level security;
alter table public.activity_keys     enable row level security;
alter table public.submissions       enable row level security;
alter table public.notification_log  enable row level security;   -- sin políticas: solo servicio

-- PROFILES
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (select 1 from public.enrollments e join public.subjects s on s.id = e.subject_id
             where e.student_id = profiles.id and s.teacher_id = auth.uid())
  or exists (select 1 from public.enrollments e join public.subjects s on s.id = e.subject_id
             where e.student_id = auth.uid() and s.teacher_id = profiles.id)
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, email_notifications) on public.profiles to authenticated;

-- SUBJECTS
create policy subjects_select on public.subjects for select to authenticated
  using (teacher_id = auth.uid() or public.is_enrolled(id));
create policy subjects_insert on public.subjects for insert to authenticated
  with check (teacher_id = auth.uid() and public.is_teacher());
create policy subjects_update on public.subjects for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
revoke update, delete on public.subjects from anon, authenticated;
grant update (name, code, group_name, semester, description, enrollment_open, grade_scale, pass_grade, auto_publish)
  on public.subjects to authenticated;

-- CORTES (se editan por RPC save_weights)
create policy cortes_select on public.cortes for select to authenticated
  using (public.owns_subject(subject_id) or public.is_enrolled(subject_id));
revoke insert, update, delete on public.cortes from anon, authenticated;

-- ENROLLMENTS (inscripción por RPC join_subject)
create policy enrollments_select on public.enrollments for select to authenticated
  using (student_id = auth.uid() or public.owns_subject(subject_id));
create policy enrollments_delete on public.enrollments for delete to authenticated
  using (public.owns_subject(subject_id));
revoke insert, update on public.enrollments from anon, authenticated;

-- ACTIVITIES
create policy activities_select on public.activities for select to authenticated using (
  public.owns_subject(subject_id)
  or (public.is_enrolled(subject_id) and published and opens_at <= now())
);
create policy activities_insert on public.activities for insert to authenticated
  with check (public.owns_subject(subject_id));
create policy activities_update on public.activities for update to authenticated
  using (public.owns_subject(subject_id)) with check (public.owns_subject(subject_id));
create policy activities_delete on public.activities for delete to authenticated
  using (public.owns_subject(subject_id));

-- ACTIVITY KEYS (solo el docente dueño)
create policy keys_all on public.activity_keys for all to authenticated
  using (public.owns_activity(activity_id)) with check (public.owns_activity(activity_id));

-- SUBMISSIONS: el docente lee las de sus asignaturas; el estudiante usa la vista student_submissions.
create policy submissions_select_teacher on public.submissions for select to authenticated
  using (public.owns_activity(activity_id));
revoke insert, update, delete on public.submissions from anon, authenticated;

revoke all on public.teacher_allowlist from anon, authenticated;
revoke all on public.notification_log from anon, authenticated;
revoke all on all tables in schema public from anon;

-- Vista del estudiante: solo sus entregas; nota y retroalimentación visibles únicamente cuando están publicadas.
create or replace view public.student_submissions as
select
  s.id, s.activity_id, s.student_id, s.content_text, s.file_path, s.file_name, s.file_mime, s.file_size,
  s.submission_count, s.submitted_at, s.is_late,
  case s.status when 'evaluada' then 'evaluada'
                when 'revision' then 'en_revision'
                else 'en_proceso' end                                   as status,
  case when s.status = 'evaluada' then coalesce(s.teacher_grade, s.ai_grade) end as grade,
  case when s.status = 'evaluada'
       then s.ai_feedback - 'alertas' - 'motivo_revision' - 'confianza' - 'requiere_revision' - 'modelo'
  end                                                                   as feedback,
  case when s.status = 'evaluada' then s.teacher_comment end            as teacher_comment,
  case when s.status = 'evaluada' then coalesce(s.reviewed_at, s.evaluated_at) end as graded_at
from public.submissions s
where s.student_id = auth.uid();

revoke all on public.student_submissions from anon;
grant select on public.student_submissions to authenticated;

-- ---------------------------------------------------------------------
-- 5. RPC para la aplicación web (validan permisos internamente)
-- ---------------------------------------------------------------------
create or replace function public.join_subject(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sub public.subjects;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  select * into v_sub from public.subjects where join_code = upper(trim(p_code));
  if not found then raise exception 'Código de inscripción inválido.'; end if;
  if v_sub.teacher_id = v_uid then raise exception 'Eres el docente de esta asignatura.'; end if;
  if not v_sub.enrollment_open then raise exception 'Las inscripciones de esta asignatura están cerradas.'; end if;
  insert into public.enrollments (subject_id, student_id) values (v_sub.id, v_uid)
  on conflict do nothing;
  return v_sub.id;
end $$;

create or replace function public.regenerate_join_code(p_subject uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text := public.gen_join_code();
begin
  update public.subjects set join_code = v_code where id = p_subject and teacher_id = auth.uid();
  if not found then raise exception 'Asignatura no encontrada.'; end if;
  return v_code;
end $$;

-- p_cortes: [{"number":1,"weight":30,"quiz_weight":30,"parcial_weight":40,"proyecto_weight":30}, ...]
create or replace function public.save_weights(p_subject uuid, p_cortes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_total numeric := 0;
begin
  if not public.owns_subject(p_subject) then raise exception 'Asignatura no encontrada.'; end if;
  if jsonb_typeof(p_cortes) <> 'array' or jsonb_array_length(p_cortes) <> 3 then
    raise exception 'Debes enviar la configuración de los 3 cortes.';
  end if;
  for r in select * from jsonb_array_elements(p_cortes) loop
    v_total := v_total + (r->>'weight')::numeric;
    if (r->>'quiz_weight')::numeric + (r->>'parcial_weight')::numeric + (r->>'proyecto_weight')::numeric <> 100 then
      raise exception 'En el corte % quiz + parcial + proyecto debe sumar 100%%.', r->>'number';
    end if;
    update public.cortes set
      weight          = (r->>'weight')::numeric,
      quiz_weight     = (r->>'quiz_weight')::numeric,
      parcial_weight  = (r->>'parcial_weight')::numeric,
      proyecto_weight = (r->>'proyecto_weight')::numeric
    where subject_id = p_subject and number = (r->>'number')::smallint;
    if not found then raise exception 'Corte inválido: %', r->>'number'; end if;
  end loop;
  if v_total <> 100 then raise exception 'Los 3 cortes deben sumar 100%% (suman %).', v_total; end if;
end $$;

create or replace function public.submit_activity(
  p_activity  uuid,
  p_text      text   default null,
  p_file_path text   default null,
  p_file_name text   default null,
  p_file_mime text   default null,
  p_file_size bigint default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_act  public.activities;
  v_sub  public.submissions;
  v_late boolean := false;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_id   uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'Debes iniciar sesión.'; end if;
  select * into v_act from public.activities where id = p_activity;
  if not found or not v_act.published or v_act.opens_at > now() then
    raise exception 'La actividad no existe o aún no está disponible.';
  end if;
  if not exists (select 1 from public.enrollments where subject_id = v_act.subject_id and student_id = v_uid) then
    raise exception 'No estás inscrito en esta asignatura.';
  end if;
  if now() > v_act.due_at then
    if not v_act.allow_late then
      raise exception 'La fecha límite ya pasó y esta actividad no admite entregas tardías.';
    end if;
    v_late := true;
  end if;
  if v_text is null and p_file_path is null then
    raise exception 'La entrega está vacía: escribe tu respuesta o adjunta un archivo.';
  end if;
  if v_text is not null and not v_act.accept_text then
    raise exception 'Esta actividad solo admite archivos.';
  end if;
  if v_text is not null and char_length(v_text) > 50000 then
    raise exception 'El texto supera 50.000 caracteres.';
  end if;
  if p_file_path is not null then
    if not v_act.accept_files then raise exception 'Esta actividad no admite archivos.'; end if;
    if p_file_path !~ ('^' || v_act.subject_id::text || '/' || v_act.id::text || '/' || v_uid::text || '/[A-Za-z0-9._-]{1,200}$')
       or position('..' in p_file_path) > 0 then
      raise exception 'Ruta de archivo inválida.';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'entregas' and name = p_file_path) then
      raise exception 'El archivo no se subió correctamente. Inténtalo de nuevo.';
    end if;
    if coalesce(p_file_size, 0) > 10485760 then raise exception 'El archivo supera 10 MB.'; end if;
  end if;

  v_status := case when v_act.ai_enabled then 'pendiente' else 'revision' end;

  select * into v_sub from public.submissions
  where activity_id = p_activity and student_id = v_uid for update;

  if found then
    if v_sub.submission_count >= v_act.max_submissions then
      raise exception 'Ya usaste los % envío(s) permitidos para esta actividad.', v_act.max_submissions;
    end if;
    update public.submissions set
      content_text = v_text, file_path = p_file_path, file_name = p_file_name, file_mime = p_file_mime,
      file_size = p_file_size, submission_count = v_sub.submission_count + 1, submitted_at = now(),
      is_late = v_late, status = v_status, ai_grade = null, ai_feedback = null, ai_model = null,
      ai_confidence = null, eval_attempts = 0, last_error = null, locked_at = null, evaluated_at = null,
      teacher_grade = null, teacher_comment = null, reviewed_at = null
    where id = v_sub.id;
    return v_sub.id;
  end if;

  insert into public.submissions (activity_id, student_id, content_text, file_path, file_name, file_mime,
                                  file_size, is_late, status)
  values (p_activity, v_uid, v_text, p_file_path, p_file_name, p_file_mime, p_file_size, v_late, v_status)
  returning id into v_id;
  return v_id;
end $$;

-- Revisión del docente. p_grade NULL = conservar la nota de la IA.
create or replace function public.review_submission(
  p_submission uuid, p_grade numeric default null, p_comment text default null, p_publish boolean default true,
  p_count int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ai    numeric;
  v_scale numeric;
  v_count int;
begin
  select s.ai_grade, sj.grade_scale, s.submission_count into v_ai, v_scale, v_count
  from public.submissions s
  join public.activities a on a.id = s.activity_id
  join public.subjects sj on sj.id = a.subject_id
  where s.id = p_submission and sj.teacher_id = auth.uid();
  if not found then raise exception 'Entrega no encontrada.'; end if;
  if p_count is not null and p_count <> v_count then
    raise exception 'El estudiante envió una nueva versión mientras revisabas. Vuelve a abrir la entrega.';
  end if;
  if p_grade is not null and (p_grade < 0 or p_grade > v_scale) then
    raise exception 'La nota debe estar entre 0 y %.', v_scale;
  end if;
  if p_publish and p_grade is null and v_ai is null then
    raise exception 'Asigna una nota: esta entrega no tiene calificación automática.';
  end if;
  update public.submissions set
    teacher_grade   = round(p_grade, 2),
    teacher_comment = nullif(btrim(coalesce(p_comment, '')), ''),
    reviewed_at     = now(),
    status          = case when p_publish then 'evaluada' else 'revision' end,
    locked_at       = null
  where id = p_submission;
end $$;

-- Nota manual (p. ej. sustentación oral o entrega recibida por otro medio).
create or replace function public.set_manual_grade(
  p_activity uuid, p_student uuid, p_grade numeric, p_comment text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_scale numeric;
  v_subject uuid;
  v_id uuid;
begin
  select a.subject_id, sj.grade_scale into v_subject, v_scale
  from public.activities a join public.subjects sj on sj.id = a.subject_id
  where a.id = p_activity and sj.teacher_id = auth.uid();
  if not found then raise exception 'Actividad no encontrada.'; end if;
  if not exists (select 1 from public.enrollments where subject_id = v_subject and student_id = p_student) then
    raise exception 'El estudiante no está inscrito.';
  end if;
  if p_grade is null or p_grade < 0 or p_grade > v_scale then
    raise exception 'La nota debe estar entre 0 y %.', v_scale;
  end if;
  insert into public.submissions (activity_id, student_id, submission_count, status, teacher_grade, teacher_comment, reviewed_at)
  values (p_activity, p_student, 0, 'evaluada', round(p_grade, 2), nullif(btrim(coalesce(p_comment, '')), ''), now())
  on conflict (activity_id, student_id) do update set
    teacher_grade = excluded.teacher_grade, teacher_comment = excluded.teacher_comment,
    reviewed_at = now(), status = 'evaluada', locked_at = null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.requeue_submission(p_submission uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.submissions s set status = 'pendiente', eval_attempts = 0, last_error = null, locked_at = null,
         teacher_grade = null, teacher_comment = null, reviewed_at = null
  from public.activities a
  where s.id = p_submission and a.id = s.activity_id and public.owns_subject(a.subject_id)
    and a.ai_enabled and (s.content_text is not null or s.file_path is not null);
  if not found then raise exception 'No se puede reevaluar esta entrega.'; end if;
end $$;

create or replace function public.mark_exported(p_subject uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := clock_timestamp();
begin
  update public.subjects set exported_at = v_now where id = p_subject and teacher_id = auth.uid();
  if not found then raise exception 'Asignatura no encontrada.'; end if;
  return v_now;
end $$;

-- Borrado en dos fases. 1) prepare_subject_deletion valida (nombre + exportación posterior al último
-- cambio de notas) y BLOQUEA la asignatura (sin inscripciones, actividades despublicadas, IA apagada).
-- 2) La web borra los archivos del Storage. 3) delete_subject borra las filas.
create or replace function public.prepare_subject_deletion(p_subject uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sub  public.subjects;
  v_last timestamptz;
begin
  select * into v_sub from public.subjects where id = p_subject and teacher_id = auth.uid() for update;
  if not found then raise exception 'Asignatura no encontrada.'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(v_sub.name)) then
    raise exception 'El nombre escrito no coincide con el de la asignatura.';
  end if;
  if v_sub.deletion_started_at is not null then return; end if;   -- reintento de un borrado ya validado
  if v_sub.exported_at is null then
    raise exception 'Antes de borrar debes descargar el historial completo de notas.';
  end if;
  select greatest(max(s.submitted_at), max(s.evaluated_at), max(s.reviewed_at)) into v_last
  from public.submissions s join public.activities a on a.id = s.activity_id
  where a.subject_id = p_subject;
  if v_last is not null and v_last > v_sub.exported_at then
    raise exception 'Hubo cambios en las notas después de tu última descarga. Descarga de nuevo el historial.';
  end if;
  update public.subjects set deletion_started_at = now(), enrollment_open = false where id = p_subject;
  update public.activities set published = false, ai_enabled = false where subject_id = p_subject;
end $$;

create or replace function public.delete_subject(p_subject uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare v_sub public.subjects;
begin
  select * into v_sub from public.subjects where id = p_subject and teacher_id = auth.uid();
  if not found then raise exception 'Asignatura no encontrada.'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(v_sub.name)) then
    raise exception 'El nombre escrito no coincide con el de la asignatura.';
  end if;
  if v_sub.deletion_started_at is null then
    raise exception 'El borrado no fue validado. Usa el botón «Borrar asignatura».';
  end if;
  delete from public.subjects where id = p_subject;
end $$;

-- ---------------------------------------------------------------------
-- 6. RPC exclusivas del AGENTE (rol service_role)
-- ---------------------------------------------------------------------
create or replace function public.claim_submissions(p_limit int default 5) returns setof jsonb
language plpgsql security definer set search_path = public as $$
begin
  -- Entregas que colgaron el proceso 3 veces: se dejan en error para revisión docente (no se reintentan sin fin).
  update public.submissions set status = 'error',
         last_error = coalesce(last_error, 'La evaluación excedió el tiempo máximo en 3 intentos.')
  where status = 'evaluando' and eval_attempts >= 3 and locked_at < now() - interval '15 minutes';

  return query
  with candidates as (
    select s.id
    from public.submissions s
    join public.activities a on a.id = s.activity_id
    where a.ai_enabled
      and (s.content_text is not null or s.file_path is not null)
      and (   s.status = 'pendiente'
           or (s.status = 'evaluando' and s.eval_attempts < 3 and s.locked_at < now() - interval '15 minutes')
           or (s.status = 'error' and s.eval_attempts < 3 and s.locked_at < now() - interval '10 minutes'))
    order by s.submitted_at
    for update of s skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ), claimed as (
    update public.submissions s
    set status = 'evaluando', locked_at = now(), eval_attempts = s.eval_attempts + 1
    from candidates c where s.id = c.id
    returning s.*
  )
  select jsonb_build_object(
    'submission', jsonb_build_object(
      'id', c.id, 'submission_count', c.submission_count, 'content_text', c.content_text,
      'file_path', c.file_path, 'file_name', c.file_name, 'file_mime', c.file_mime, 'file_size', c.file_size,
      'is_late', c.is_late, 'submitted_at', c.submitted_at, 'eval_attempts', c.eval_attempts),
    'activity', jsonb_build_object(
      'id', a.id, 'title', a.title, 'component', a.component, 'instructions', a.instructions,
      'rubric', a.rubric, 'statement_path', a.statement_path, 'statement_name', a.statement_name,
      'due_at', a.due_at),
    'key', jsonb_build_object(
      'reference_solution', k.reference_solution, 'reference_path', k.reference_path,
      'reference_name', k.reference_name, 'grading_notes', k.grading_notes),
    'subject', jsonb_build_object(
      'id', sj.id, 'name', sj.name, 'grade_scale', sj.grade_scale, 'pass_grade', sj.pass_grade,
      'auto_publish', sj.auto_publish),
    'corte', co.number)
  from claimed c
  join public.activities a on a.id = c.activity_id
  join public.subjects sj on sj.id = a.subject_id
  join public.cortes co on co.id = a.corte_id
  left join public.activity_keys k on k.activity_id = a.id;
end $$;

-- Devuelve el estado final ('evaluada' | 'revision') o 'stale' si el estudiante reenvió mientras se evaluaba.
create or replace function public.complete_evaluation(
  p_submission uuid, p_count int, p_grade numeric, p_feedback jsonb,
  p_model text, p_confidence numeric, p_needs_review boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_scale  numeric;
  v_auto   boolean;
  v_status text;
begin
  select sj.grade_scale, sj.auto_publish into v_scale, v_auto
  from public.submissions s join public.activities a on a.id = s.activity_id
  join public.subjects sj on sj.id = a.subject_id where s.id = p_submission;
  if not found then return 'stale'; end if;
  v_status := case when p_needs_review or not v_auto then 'revision' else 'evaluada' end;
  update public.submissions set
    status = v_status,
    ai_grade = round(least(greatest(p_grade, 0), v_scale), 2),
    ai_feedback = p_feedback,
    ai_model = left(p_model, 80),
    ai_confidence = round(least(greatest(coalesce(p_confidence, 0), 0), 1), 2),
    evaluated_at = now(),
    last_error = null,
    locked_at = null
  where id = p_submission and submission_count = p_count and status = 'evaluando';
  if not found then return 'stale'; end if;
  return v_status;
end $$;

create or replace function public.fail_evaluation(p_submission uuid, p_count int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.submissions set status = 'error', last_error = left(p_error, 1000)
  where id = p_submission and submission_count = p_count and status = 'evaluando';
end $$;

-- Recordatorios: una ventana por envío (72h, 24h, 3h). La clave incluye la fecha límite,
-- así que si el docente la mueve, los recordatorios se vuelven a enviar.
create or replace function public.due_reminders(p_now timestamptz default now())
returns table (user_id uuid, email text, full_name text, activity_id uuid, activity_title text,
               subject_name text, component text, corte smallint, due_at timestamptz, kind text)
language sql stable security definer set search_path = public as $$
  with w as (
    select a.*, sj.name as subject_name, co.number as corte_number,
      case when a.due_at - p_now <= interval '3 hours'  then 'rec3'
           when a.due_at - p_now <= interval '24 hours' then 'rec24'
           else 'rec72' end || ':' || extract(epoch from a.due_at)::bigint as kind
    from public.activities a
    join public.subjects sj on sj.id = a.subject_id
    join public.cortes co on co.id = a.corte_id
    where a.published and a.opens_at <= p_now
      and a.due_at > p_now and a.due_at <= p_now + interval '72 hours'
  )
  select p.id, p.email, p.full_name, w.id, w.title, w.subject_name, w.component, w.corte_number, w.due_at, w.kind
  from w
  join public.enrollments e on e.subject_id = w.subject_id
  join public.profiles p on p.id = e.student_id and p.email_notifications
  where not exists (select 1 from public.submissions s where s.activity_id = w.id and s.student_id = p.id)
    and not exists (select 1 from public.notification_log n
                    where n.user_id = p.id and n.activity_id = w.id and n.kind = w.kind)
    -- evita dos correos seguidos: el recordatorio espera 12 h tras el aviso de actividad nueva (salvo el de 3 h)
    and (w.kind like 'rec3:%' or exists (select 1 from public.notification_log n
           where n.user_id = p.id and n.activity_id = w.id and n.kind = 'nueva' and n.sent_at <= p_now - interval '12 hours'))
  order by w.due_at;
$$;

create or replace function public.new_activity_notices(p_now timestamptz default now())
returns table (user_id uuid, email text, full_name text, activity_id uuid, activity_title text,
               subject_name text, component text, corte smallint, due_at timestamptz, kind text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, a.id, a.title, sj.name, a.component, co.number, a.due_at, 'nueva'
  from public.activities a
  join public.subjects sj on sj.id = a.subject_id
  join public.cortes co on co.id = a.corte_id
  join public.enrollments e on e.subject_id = a.subject_id
  join public.profiles p on p.id = e.student_id and p.email_notifications
  where a.published and a.opens_at <= p_now and a.due_at > p_now
    and a.due_at - p_now > interval '3 hours'          -- si quedan <3h, basta el recordatorio urgente
    and not exists (select 1 from public.submissions s where s.activity_id = a.id and s.student_id = p.id)
    and not exists (select 1 from public.notification_log n
                    where n.user_id = p.id and n.activity_id = a.id and n.kind = 'nueva')
  order by a.due_at;
$$;

create or replace function public.feedback_notices()
returns table (user_id uuid, email text, full_name text, activity_id uuid, activity_title text,
               subject_name text, submission_id uuid, grade numeric, grade_scale numeric,
               summary text, kind text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, a.id, a.title, sj.name, s.id,
         coalesce(s.teacher_grade, s.ai_grade), sj.grade_scale,
         s.ai_feedback->>'resumen',
         'retro:' || s.submission_count || ':' || extract(epoch from coalesce(s.evaluated_at, s.reviewed_at))::bigint
  from public.submissions s
  join public.activities a on a.id = s.activity_id
  join public.subjects sj on sj.id = a.subject_id
  join public.profiles p on p.id = s.student_id and p.email_notifications
  where s.status = 'evaluada'
    and coalesce(s.reviewed_at, s.evaluated_at) > now() - interval '7 days'
    and not exists (select 1 from public.notification_log n
                    where n.user_id = p.id and n.activity_id = a.id
                      and n.kind = 'retro:' || s.submission_count || ':' || extract(epoch from coalesce(s.evaluated_at, s.reviewed_at))::bigint)
  order by s.evaluated_at;
$$;

-- Resumen diario para el docente: entregas que requieren su revisión o que fallaron.
create or replace function public.teacher_digests(p_day date)
returns table (user_id uuid, email text, full_name text, kind text, items jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, 'resumen:' || p_day::text,
         jsonb_agg(jsonb_build_object(
           'subject', sj.name, 'subject_id', sj.id, 'activity', a.title, 'activity_id', a.id,
           'student', st.full_name, 'status', s.status) order by sj.name, a.title)
  from public.submissions s
  join public.activities a on a.id = s.activity_id
  join public.subjects sj on sj.id = a.subject_id
  join public.profiles p on p.id = sj.teacher_id
  join public.profiles st on st.id = s.student_id
  where (s.status = 'revision' or (s.status = 'error' and s.eval_attempts >= 3))
    and not exists (select 1 from public.notification_log n
                    where n.user_id = p.id and n.activity_id is null and n.kind = 'resumen:' || p_day::text)
  group by p.id, p.email, p.full_name;
$$;

-- Reserva atómica antes de enviar un correo (true = este proceso debe enviarlo).
create or replace function public.claim_notification(p_user uuid, p_activity uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_log (user_id, activity_id, kind) values (p_user, p_activity, p_kind)
  on conflict do nothing;
  return found;
end $$;

-- Si el envío falla se libera la reserva para reintentar en la siguiente ejecución.
create or replace function public.release_notification(p_user uuid, p_activity uuid, p_kind text) returns void
language sql security definer set search_path = public as $$
  delete from public.notification_log
  where user_id = p_user and activity_id is not distinct from p_activity and kind = p_kind;
$$;

create or replace function public.emails_sent_since(p_since timestamptz) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notification_log where sent_at >= p_since;
$$;

-- Permisos de ejecución: RPC del agente solo para service_role.
revoke execute on function public.claim_submissions(int)                                      from public, anon, authenticated;
revoke execute on function public.complete_evaluation(uuid, int, numeric, jsonb, text, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.fail_evaluation(uuid, int, text)                            from public, anon, authenticated;
revoke execute on function public.due_reminders(timestamptz)                                   from public, anon, authenticated;
revoke execute on function public.new_activity_notices(timestamptz)                            from public, anon, authenticated;
revoke execute on function public.feedback_notices()                                           from public, anon, authenticated;
revoke execute on function public.teacher_digests(date)                                        from public, anon, authenticated;
revoke execute on function public.claim_notification(uuid, uuid, text)                         from public, anon, authenticated;
revoke execute on function public.release_notification(uuid, uuid, text)                       from public, anon, authenticated;
revoke execute on function public.emails_sent_since(timestamptz)                               from public, anon, authenticated;
grant execute on function public.claim_submissions(int)                                        to service_role;
grant execute on function public.complete_evaluation(uuid, int, numeric, jsonb, text, numeric, boolean) to service_role;
grant execute on function public.fail_evaluation(uuid, int, text)                              to service_role;
grant execute on function public.due_reminders(timestamptz)                                    to service_role;
grant execute on function public.new_activity_notices(timestamptz)                             to service_role;
grant execute on function public.feedback_notices()                                            to service_role;
grant execute on function public.teacher_digests(date)                                         to service_role;
grant execute on function public.claim_notification(uuid, uuid, text)                          to service_role;
grant execute on function public.release_notification(uuid, uuid, text)                        to service_role;
grant execute on function public.emails_sent_since(timestamptz)                                to service_role;

-- RPC de la web: nunca para anon.
revoke execute on function public.join_subject(text)                                from public, anon;
revoke execute on function public.regenerate_join_code(uuid)                        from public, anon;
revoke execute on function public.save_weights(uuid, jsonb)                         from public, anon;
revoke execute on function public.submit_activity(uuid, text, text, text, text, bigint) from public, anon;
revoke execute on function public.review_submission(uuid, numeric, text, boolean, int) from public, anon;
revoke execute on function public.set_manual_grade(uuid, uuid, numeric, text)       from public, anon;
revoke execute on function public.requeue_submission(uuid)                          from public, anon;
revoke execute on function public.mark_exported(uuid)                               from public, anon;
revoke execute on function public.delete_subject(uuid, text)                        from public, anon;
revoke execute on function public.prepare_subject_deletion(uuid, text)              from public, anon;
grant execute on function public.join_subject(text)                                 to authenticated;
grant execute on function public.regenerate_join_code(uuid)                         to authenticated;
grant execute on function public.save_weights(uuid, jsonb)                          to authenticated;
grant execute on function public.submit_activity(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.review_submission(uuid, numeric, text, boolean, int) to authenticated;
grant execute on function public.set_manual_grade(uuid, uuid, numeric, text)        to authenticated;
grant execute on function public.requeue_submission(uuid)                           to authenticated;
grant execute on function public.mark_exported(uuid)                                to authenticated;
grant execute on function public.delete_subject(uuid, text)                         to authenticated;
grant execute on function public.prepare_subject_deletion(uuid, text)               to authenticated;

-- ---------------------------------------------------------------------
-- 7. Storage: buckets privados y políticas
--    materiales/{subject_id}/{activity_id}/enunciado/{archivo}   (estudiantes inscritos pueden leer)
--    materiales/{subject_id}/{activity_id}/referencia/{archivo}  (solo docente)
--    entregas/{subject_id}/{activity_id}/{student_id}/{archivo}
-- ---------------------------------------------------------------------
-- Un estudiante solo sube en {asignatura}/{actividad}/{su uid}/, la actividad debe pertenecer a esa
-- asignatura y estar abierta para él, y como máximo 15 archivos por carpeta (evita llenar el Storage).
create or replace function public.can_upload_submission(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  f text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(f, 1), 0) <> 3 or f[3] <> auth.uid()::text then return false; end if;
  if not exists (select 1 from public.activities a
                 where a.id = public.try_uuid(f[2]) and a.subject_id = public.try_uuid(f[1])) then return false; end if;
  if not public.activity_visible_to_student(public.try_uuid(f[2])) then return false; end if;
  return (select count(*) from storage.objects o
          where o.bucket_id = 'entregas' and o.name like f[1] || '/' || f[2] || '/' || f[3] || '/%') < 15;
end $$;
revoke execute on function public.can_upload_submission(text) from public, anon;
grant execute on function public.can_upload_submission(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('materiales', 'materiales', false, 10485760),
       ('entregas',   'entregas',   false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

create policy materiales_teacher_all on storage.objects for all to authenticated
  using (bucket_id = 'materiales' and public.owns_subject(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'materiales' and public.owns_subject(public.try_uuid((storage.foldername(name))[1])));

create policy materiales_student_read on storage.objects for select to authenticated
  using (bucket_id = 'materiales'
         and (storage.foldername(name))[3] = 'enunciado'
         and public.activity_visible_to_student(public.try_uuid((storage.foldername(name))[2])));

create policy entregas_student_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'entregas' and public.can_upload_submission(name));

create policy entregas_student_read on storage.objects for select to authenticated
  using (bucket_id = 'entregas' and (storage.foldername(name))[3] = auth.uid()::text
         and public.is_enrolled(public.try_uuid((storage.foldername(name))[1])));

create policy entregas_student_delete on storage.objects for delete to authenticated
  using (bucket_id = 'entregas' and (storage.foldername(name))[3] = auth.uid()::text
         and public.is_enrolled(public.try_uuid((storage.foldername(name))[1])));

create policy entregas_teacher_read on storage.objects for select to authenticated
  using (bucket_id = 'entregas' and public.owns_subject(public.try_uuid((storage.foldername(name))[1])));

create policy entregas_teacher_delete on storage.objects for delete to authenticated
  using (bucket_id = 'entregas' and public.owns_subject(public.try_uuid((storage.foldername(name))[1])));

commit;

-- =====================================================================
-- DESPUÉS DE EJECUTAR: autoriza tu correo como docente (cámbialo por el tuyo):
--   insert into public.teacher_allowlist (email) values ('tu.correo@gmail.com');
-- =====================================================================
