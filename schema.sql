-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create unique index exercises_name_key on exercises (lower(name));

create table workouts (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One exercise done during one workout
create table workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts on delete cascade,
  exercise_id uuid not null references exercises on delete restrict,
  created_at timestamptz not null default now()
);
create index on workout_exercises (exercise_id, created_at desc);
create index on workout_exercises (workout_id);

-- What one member did for one workout exercise.
-- sets is a list like [{"reps": 10, "weight": 60}, {"reps": 8, "weight": 65}]
create table entries (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references workout_exercises on delete cascade,
  member_id uuid not null references members on delete cascade,
  absent boolean not null default false,
  sets jsonb not null default '[]',
  unique (workout_exercise_id, member_id)
);
create index on entries (member_id);

-- Security: anyone can read, only the signed-in group account can write.
-- BEFORE RUNNING: replace YOUR@EMAIL below (twice) with the email of the group user (same as GROUP_EMAIL in config.js).
grant select on members, exercises, workouts, workout_exercises, entries to anon;
grant select, insert, update, delete on members, exercises, workouts, workout_exercises, entries to authenticated;

do $$
declare t text;
begin
  foreach t in array array['members', 'exercises', 'workouts', 'workout_exercises', 'entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select using (true)', t);
    execute format($p$create policy "group write" on %I for all to authenticated
      using (auth.jwt() ->> 'email' = 'YOUR@EMAIL')
      with check (auth.jwt() ->> 'email' = 'YOUR@EMAIL')$p$, t);
  end loop;
end $$;

-- ---------- Exercise photos ----------
alter table exercises add column photo_path text;

insert into storage.buckets (id, name, public)
values ('exercise-photos', 'exercise-photos', true)
on conflict (id) do nothing;

create policy "group read exercise photos" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-photos');
create policy "group upload exercise photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-photos');
create policy "group delete exercise photos" on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-photos');

-- ---------- Private: reading also needs the group password ----------
-- Removes the "anyone can read" rules; the signed-in group account can still read through "group write".
do $$
declare t text;
begin
  foreach t in array array['members', 'exercises', 'workouts', 'workout_exercises', 'entries'] loop
    execute format('drop policy if exists "public read" on %I', t);
  end loop;
end $$;
revoke select on members, exercises, workouts, workout_exercises, entries from anon;
