-- 005_tasks.sql
-- Task requests from the app: the user picks category -> help type ->
-- service, a timing and free-text details; their Lifestyle Manager
-- handles it later.
--
--   category / help_type / service : display labels, the app owns the catalog
--   day / slot                     : set only when timing = 'scheduled'
--   address_id                     : the user's default address at creation
--
-- Relationship: users 1 ──< N tasks. Status changes past 'pending' are made
-- by the LM/admin side; the user API can only cancel.

BEGIN;

create table tasks (
  id          uuid primary key default gen_random_uuid(),

  user_id     uuid not null references users(id) on delete cascade,
  -- Addresses are soft-deleted, so this only fires on a hard delete.
  address_id  uuid references addresses(id) on delete set null,

  category    text not null check (char_length(category)  between 1 and 80),
  help_type   text not null check (char_length(help_type) between 1 and 80),
  service     text not null check (char_length(service)   between 1 and 120),

  timing      text not null
                check (timing in ('standard', 'same_day', 'express', 'scheduled')),
  day         date,
  slot        text check (slot in ('morning', 'afternoon', 'evening')),

  details     text not null check (char_length(details) between 1 and 1000),

  status      text not null default 'pending'
                check (status in ('pending', 'assigned', 'in_progress', 'completed', 'cancelled')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- day and slot are both set for scheduled tasks and both null otherwise
  constraint tasks_schedule_check check (
    (timing = 'scheduled' and day is not null and slot is not null)
    or (timing <> 'scheduled' and day is null and slot is null)
  )
);

-- Serves the list endpoint: one user's tasks, optionally by status, newest first.
create index idx_tasks_user_status_created
  on tasks (user_id, status, created_at desc);

create trigger trg_tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();

COMMIT;
