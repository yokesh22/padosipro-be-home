-- 003_add_phone_to_users.sql
-- Adds a required phone number to users.
--
-- Stored in E.164 format ('+919876543210'): a leading '+', country code,
-- then subscriber number, 8 to 15 digits in total. Normalise in Node
-- before insert so the same number can't be stored two different ways.
--
-- NOT NULL with no default: if users already has rows, this fails and the
-- transaction rolls back. Backfill those rows first (or delete test data).

BEGIN;

alter table users
  add column phone_number text not null
    check (phone_number ~ '^\+[1-9][0-9]{7,14}$');

-- Phone is unique only among live rows, the same way email is, so a
-- soft-deleted user's number can be registered again.
create unique index idx_users_phone_active
  on users (phone_number)
  where deleted_at is null;

COMMIT;
