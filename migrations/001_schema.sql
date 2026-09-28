-- =====================================================================
-- 001_schema.sql
-- Auth + profile + addresses
-- PostgreSQL 13+
-- Run once, top to bottom, on an empty database.
-- =====================================================================


-- =====================================================================
-- EXTENSIONS
-- =====================================================================

-- citext: case-insensitive text. Used for email so that
-- 'User@x.com' and 'user@x.com' cannot both register.
create extension if not exists citext;

-- pgcrypto: provides gen_random_uuid() on PostgreSQL < 13.
-- Harmless to include on 13+ where the function is built in.
create extension if not exists pgcrypto;


-- =====================================================================
-- SHARED TRIGGER: keep updated_at accurate
-- =====================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- =====================================================================
-- TABLE: users
-- One row per account.
-- =====================================================================

create table users (
  -- Primary key. UUID, not serial, so ids are not guessable
  -- and are safe to expose in URLs and API responses.
  id                uuid primary key default gen_random_uuid(),

  -- Credentials -------------------------------------------------------
  email             citext not null,
  password_hash     text   not null,   -- argon2id (~95 chars) or bcrypt (60).
                                       -- text, not varchar(n), so switching
                                       -- algorithms later needs no migration.

  -- Email verification ------------------------------------------------
  -- Timestamp rather than boolean: gives you the boolean for free
  -- (email_verified_at is not null) plus the time it happened.
  email_verified_at timestamptz,

  -- Profile -----------------------------------------------------------
  full_name         text,
  business_name     text,              -- null for personal accounts
  account_type      text not null default 'personal'
                      check (account_type in ('personal', 'business')),

  -- Lifecycle ---------------------------------------------------------
  -- status is what every login query reads: one indexed equality check.
  -- The timestamps beside it are the audit trail.
  status            text not null default 'active'
                      check (status in ('active', 'disabled', 'deleted')),
  disabled_at       timestamptz,
  disabled_reason   text,
  deleted_at        timestamptz,       -- soft delete marker

  -- Audit -------------------------------------------------------------
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Email is unique only among live rows.
--
-- A plain UNIQUE constraint would block a soft-deleted user's email
-- forever, so they could never re-register. This partial index means
-- deleted rows do not compete for the address.
create unique index idx_users_email_active
  on users (email)
  where deleted_at is null;

-- Covers the common "find this active account" lookup.
create index idx_users_active
  on users (id)
  where status = 'active' and deleted_at is null;

create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();


-- =====================================================================
-- TABLE: addresses
-- Relationship: users 1 ──< N addresses
--
-- A separate table rather than columns on users, because a services
-- app almost always ends up needing more than one address per user
-- (home + office, or booking for a parent's flat).
-- =====================================================================

create table addresses (
  id          uuid primary key default gen_random_uuid(),

  -- Foreign key. ON DELETE CASCADE only fires on a hard delete of the
  -- user row; soft deletes leave these rows intact.
  user_id     uuid not null references users(id) on delete cascade,

  label       text,                  -- 'Home', 'Office', 'Mom's place'

  flat_unit   text not null,         -- 'B-402'
  society     text,                  -- 'Green Meadows Apartments'
  area        text not null,         -- 'Thillai Nagar'
  city        text not null,
  state       text,
  pincode     text,
  landmark    text,

  -- Optional geocoding. numeric(9,6) gives ~11cm precision,
  -- which is far more than an address needs.
  latitude    numeric(9,6),
  longitude   numeric(9,6),

  is_default  boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index idx_addresses_user
  on addresses (user_id)
  where deleted_at is null;

-- Exactly one default address per user, enforced by the database
-- rather than by hoping the application layer gets it right.
create unique index idx_addresses_one_default
  on addresses (user_id)
  where is_default and deleted_at is null;

create trigger trg_addresses_updated_at
  before update on addresses
  for each row execute function set_updated_at();


-- =====================================================================
-- TABLE: email_verification_codes
-- Relationship: users 1 ──< N codes
--
-- One row per code SENT, never updated in place on resend. That gives
-- you the cooldown check (newest row's created_at) and an audit trail
-- of how many codes a user requested, which is how you spot abuse.
-- =====================================================================

create table email_verification_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,

  -- Hash of the 6-digit code, never the code itself.
  --
  -- IMPORTANT: a 6-digit code is only 1,000,000 possibilities, so a
  -- plain sha256 is effectively plaintext -- an attacker with your DB
  -- precomputes all million hashes in under a second. Use either:
  --   (a) bcrypt.hash(code, 10)                       -- simple
  --   (b) HMAC-SHA256(code, OTP_PEPPER from env)      -- fast
  code_hash     text not null,

  purpose       text not null default 'email_verify'
                  check (purpose in ('email_verify', 'password_reset')),

  expires_at    timestamptz not null,    -- set to now() + 10 minutes

  -- Attempt counter lives HERE, not on users. Five wrong tries kills
  -- this code, not the account; a resend creates a fresh row with a
  -- fresh counter.
  attempt_count smallint not null default 0,

  -- Single use. Set on successful verify, and also set on the previous
  -- row whenever a new code is issued, so only the newest code works.
  consumed_at   timestamptz,

  created_at    timestamptz not null default now()
);

-- Serves both the cooldown check and the "newest usable code" lookup.
create index idx_evc_lookup
  on email_verification_codes (user_id, purpose, created_at desc);


-- =====================================================================
-- TABLE: refresh_tokens
-- Relationship: users 1 ──< N tokens (one row per active device/session)
--
-- Drop this table if you only need a short-lived JWT with no server-side
-- logout and no "stay signed in". Keep it if you want Instagram-style
-- sessions that survive app restarts.
-- =====================================================================

create table refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,

  -- Hash of the token, never the token. A database dump must not hand
  -- over live sessions. sha256 is fine here: the token is long and
  -- random, unlike a 6-digit OTP.
  token_hash   text not null unique,

  -- Rotation lineage. Every token descended from one login shares this
  -- id, so detecting reuse of an already-consumed token lets you revoke
  -- the entire family in a single UPDATE.
  family_id    uuid not null,

  expires_at   timestamptz not null,   -- now() + 60 days, sliding
  revoked_at   timestamptz,

  -- Shown on a "your active sessions" screen.
  user_agent   text,
  ip           inet,

  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index idx_rt_user_active
  on refresh_tokens (user_id)
  where revoked_at is null;

create index idx_rt_family
  on refresh_tokens (family_id);


-- =====================================================================
-- RELATIONSHIP SUMMARY
--
--   users ──1:N──> addresses
--     ├───1:N──> email_verification_codes
--     └───1:N──> refresh_tokens
--
-- All one-to-many. No one-to-one tables in this schema.
-- =====================================================================
