-- ==============================================================================
-- CareQueue Supabase Schema & Realtime Setup
-- ==============================================================================

-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 2. Clinics table
create table if not exists clinics (
  id uuid default gen_random_uuid() primary key,
  handle text unique not null,
  name text not null,
  doctor_name text not null,
  specialty text not null default 'Family medicine',
  photo text default '',
  status text not null default 'Active' check (status in ('Trial', 'Active', 'Suspended', 'Blocked')),
  verified boolean not null default false,
  internal_notes text default '',
  plan text not null default 'Trial',
  trial_expiry date,
  paid_until date,
  onboarding jsonb not null default '{"profile": true, "hours": true, "qrPlaced": false, "firstBooking": false, "assistantTrained": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Clinic Hours table
create table if not exists clinic_hours (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid references clinics(id) on delete cascade not null,
  day_of_week int not null check (day_of_week between 0 and 6),
  day_name text not null,
  is_open boolean not null default true,
  windows jsonb not null default '[]'::jsonb, -- e.g. [{"start": "09:00", "end": "17:00"}]
  unique(clinic_id, day_of_week)
);

-- 4. Bookings / Queue Entries table
create table if not exists bookings (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid references clinics(id) on delete cascade not null,
  tracking_code text unique not null,
  date date not null,
  session text not null,
  queue_number int not null,
  name text not null,
  phone text not null,
  age int not null default 0,
  gender text not null default 'female',
  status text not null default 'waiting' check (status in ('waiting', 'serving', 'done', 'skipped', 'cancelled')),
  revisit_date date,
  coming_in_minutes int,
  coming_in_deadline timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Absolute database constraint against duplicate queue numbers for the same clinic on the same day:
  unique(clinic_id, date, queue_number)
);

-- Index for instant queue lookups by clinic and date
create index if not exists idx_bookings_clinic_date on bookings(clinic_id, date, queue_number);
create index if not exists idx_bookings_tracking_code on bookings(tracking_code);
create index if not exists idx_bookings_phone on bookings(phone);

-- 5. Arrival Notices table
create table if not exists arrival_notices (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid references clinics(id) on delete cascade not null,
  tracking_code text not null,
  queue_number int not null,
  minutes int not null,
  until timestamptz not null,
  message text not null,
  created_at timestamptz not null default now(),
  unique(clinic_id, tracking_code)
);

create index if not exists idx_arrival_notices_lookup on arrival_notices(clinic_id, tracking_code);

-- 6. Atomic Daily Sequential Queue Numbering Function
-- Completely eliminates multi-tab race conditions via advisory locking per clinic+date
create or replace function get_next_queue_number(p_clinic_id uuid, p_date date)
returns int
language plpgsql
as $$
declare
  v_lock_key bigint;
  v_next int;
begin
  -- Generate a 64-bit lock key derived from clinic_id and date
  v_lock_key := ('x' || substr(md5(p_clinic_id::text || p_date::text), 1, 16))::bit(64)::bigint;
  
  -- Acquire transaction-level advisory lock
  perform pg_advisory_xact_lock(v_lock_key);
  
  select coalesce(max(queue_number), 0) + 1
  into v_next
  from bookings
  where clinic_id = p_clinic_id and date = p_date;
  
  return v_next;
end;
$$;

-- 7. Stored Procedure to atomically add a booking
create or replace function create_booking(
  p_clinic_handle text,
  p_date date,
  p_session text,
  p_name text,
  p_phone text,
  p_age int,
  p_gender text,
  p_tracking_code text
)
returns json
language plpgsql
as $$
declare
  v_clinic clinics%rowtype;
  v_queue_num int;
  v_booking bookings%rowtype;
begin
  -- Resolve clinic
  select * into v_clinic from clinics where lower(handle) = lower(p_clinic_handle);
  if not found then
    raise exception 'Clinic not found';
  end if;

  if v_clinic.status = 'Suspended' or v_clinic.status = 'Blocked' then
    raise exception 'This clinic is temporarily unavailable';
  end if;

  -- Check existing active booking with same phone for this session to prevent duplicate double-clicks
  select * into v_booking
  from bookings
  where clinic_id = v_clinic.id
    and date = p_date
    and phone = p_phone
    and status not in ('cancelled', 'done')
  limit 1;

  if found then
    return row_to_json(v_booking);
  end if;

  -- Get sequential number safely
  v_queue_num := get_next_queue_number(v_clinic.id, p_date);

  insert into bookings (
    clinic_id,
    tracking_code,
    date,
    session,
    queue_number,
    name,
    phone,
    age,
    gender,
    status
  ) values (
    v_clinic.id,
    p_tracking_code,
    p_date,
    p_session,
    v_queue_num,
    p_name,
    p_phone,
    coalesce(p_age, 0),
    coalesce(p_gender, 'female'),
    'waiting'
  )
  returning * into v_booking;

  return row_to_json(v_booking);
end;
$$;

-- 8. Seed default demo clinic (Willow Family Clinic)
insert into clinics (handle, name, doctor_name, specialty, status, plan, verified)
values ('willow-family-clinic', 'Willow Family Clinic', 'Dr. Maya Patel', 'Family medicine', 'Active', 'Professional', true)
on conflict (handle) do nothing;

-- Seed default schedule for Willow Family Clinic
do $$
declare
  v_willow_id uuid;
begin
  select id into v_willow_id from clinics where handle = 'willow-family-clinic';
  if v_willow_id is not null then
    insert into clinic_hours (clinic_id, day_of_week, day_name, is_open, windows)
    values
      (v_willow_id, 1, 'Monday', true, '[{"start": "09:00", "end": "17:00"}]'::jsonb),
      (v_willow_id, 2, 'Tuesday', true, '[{"start": "09:00", "end": "17:00"}]'::jsonb),
      (v_willow_id, 3, 'Wednesday', true, '[{"start": "09:00", "end": "17:00"}]'::jsonb),
      (v_willow_id, 4, 'Thursday', true, '[{"start": "09:00", "end": "17:00"}]'::jsonb),
      (v_willow_id, 5, 'Friday', true, '[{"start": "09:00", "end": "16:00"}]'::jsonb),
      (v_willow_id, 6, 'Saturday', false, '[]'::jsonb),
      (v_willow_id, 0, 'Sunday', false, '[]'::jsonb)
    on conflict (clinic_id, day_of_week) do nothing;
  end if;
end $$;

-- 9. Enable Row Level Security (RLS)
alter table clinics enable row level security;
alter table clinic_hours enable row level security;
alter table bookings enable row level security;
alter table arrival_notices enable row level security;

-- Permissive policies for prototype / public clinic booking
-- (Can be refined with Supabase Auth for clinic logins)
create policy "Allow public read clinics" on clinics for select using (true);
create policy "Allow public insert/update clinics" on clinics for all using (true);

create policy "Allow public read clinic_hours" on clinic_hours for select using (true);
create policy "Allow public update clinic_hours" on clinic_hours for all using (true);

create policy "Allow public read bookings" on bookings for select using (true);
create policy "Allow public insert/update bookings" on bookings for all using (true);

create policy "Allow public read arrival_notices" on arrival_notices for select using (true);
create policy "Allow public all arrival_notices" on arrival_notices for all using (true);

-- 10. Enable Realtime Publications
alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table arrival_notices;
alter publication supabase_realtime add table clinics;
