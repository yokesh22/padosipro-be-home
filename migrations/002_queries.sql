-- =====================================================================
-- 002_queries.sql
-- Runtime queries, grouped by flow. Reference, not a migration.
-- $1, $2... are node-postgres positional parameters.
-- =====================================================================


-- =====================================================================
-- 1. REGISTER
-- =====================================================================

-- 1a. Create the account.
--     password_hash is computed in Node BEFORE this runs:
--       argon2.hash(password)   or   bcrypt.hash(password, 12)
--     Never send a plain password to PostgreSQL.
insert into users (email, password_hash, full_name, business_name, account_type)
values ($1, $2, $3, $4, $5)
returning id, email, created_at;

-- If this raises unique_violation (code 23505) on idx_users_email_active,
-- the email is already taken by a live account.
--
-- Do NOT reply "email already registered" -- that confirms to a stranger
-- which emails have accounts. Send the same "check your inbox" response
-- as a success, and email the existing owner a "someone tried to sign up
-- with your address" notice instead.


-- =====================================================================
-- 2. SEND / RESEND OTP
-- =====================================================================

-- 2a. Cooldown check. Read the newest code row for this user.
select created_at
from email_verification_codes
where user_id = $1
  and purpose = 'email_verify'
order by created_at desc
limit 1;
--
-- In Node: if a row came back and
--   (Date.now() - created_at) < 30_000
-- respond 429 Too Many Requests and stop here.


-- 2b. Invalidate every previous unused code, then insert the new one.
--     BOTH statements inside ONE transaction.

begin;

update email_verification_codes
set consumed_at = now()
where user_id = $1
  and purpose = 'email_verify'
  and consumed_at is null;

insert into email_verification_codes (user_id, code_hash, purpose, expires_at)
values ($1, $2, 'email_verify', now() + interval '10 minutes')
returning id, expires_at;

commit;

-- Send the email AFTER commit succeeds. If the mail send fails, the row
-- still exists and the user can hit resend -- that is the safe direction
-- to fail in.


-- =====================================================================
-- 3. VERIFY OTP
-- =====================================================================

begin;

-- 3a. Fetch the newest usable code.
--     FOR UPDATE locks the row so two concurrent verify requests cannot
--     both pass the attempt check.
select id, code_hash, attempt_count
from email_verification_codes
where user_id = $1
  and purpose = 'email_verify'
  and consumed_at is null
  and expires_at > now()
order by created_at desc
limit 1
for update;

--  No row       -> 400 "Code expired or already used. Request a new one."
--  attempt_count >= 5 -> 429 "Too many attempts. Request a new code."
--  Otherwise compare in Node:
--     bcrypt.compare(code, row.code_hash)
--     or timingSafeEqual(hmac(code), row.code_hash)


-- 3b. WRONG code -> burn one attempt, commit, return 400.
update email_verification_codes
set attempt_count = attempt_count + 1
where id = $1;

-- 3c. CORRECT code -> consume it and mark the user verified.
--     Both statements, same transaction.
update email_verification_codes
set consumed_at = now()
where id = $1;

update users
set email_verified_at = now()
where id = $2
  and email_verified_at is null;   -- idempotent: keeps the first timestamp

commit;


-- =====================================================================
-- 4. LOGIN
-- =====================================================================

-- 4a. Single lookup. deleted_at filter hides soft-deleted accounts
--     completely -- they should behave as if they never existed.
select id, password_hash, email_verified_at, status, full_name
from users
where email = $1
  and deleted_at is null;

-- CHECK ORDER MATTERS. Do it exactly like this:
--
--   1. No row found
--        -> still run a dummy hash compare against a fixed throwaway
--           hash, then return 401 "Invalid email or password".
--           Without the dummy compare, the faster response time tells
--           an attacker the email is unregistered.
--
--   2. Password mismatch
--        -> 401 "Invalid email or password"   (same message as above)
--
--   3. status = 'disabled'
--        -> 403 "Account suspended, contact support"
--
--   4. email_verified_at is null
--        -> 403 { code: 'EMAIL_NOT_VERIFIED' }
--           Flutter routes to the OTP screen and triggers a resend.
--
--   5. status = 'active' and verified
--        -> issue tokens (section 5)
--
-- Checking status or verification BEFORE the password turns the login
-- endpoint into an oracle for which emails exist and which are suspended.


-- 4b. On success, record the login.
update users
set last_login_at = now()
where id = $1;


-- =====================================================================
-- 5. ISSUE TOKENS
-- =====================================================================

-- Access token: a signed JWT, 1 hour expiry, NOT stored in the database.
-- Refresh token: 64 random bytes, stored here as a hash.
--
--   const raw  = crypto.randomBytes(64).toString('hex');
--   const hash = crypto.createHash('sha256').update(raw).digest('hex');
--   // send `raw` to the client, store `hash`

-- 5a. New login -> a brand new family.
insert into refresh_tokens
  (user_id, token_hash, family_id, expires_at, user_agent, ip)
values
  ($1, $2, gen_random_uuid(), now() + interval '60 days', $3, $4)
returning id, family_id, expires_at;


-- =====================================================================
-- 6. REFRESH  (rotation + reuse detection)
-- =====================================================================

begin;

-- 6a. Look up the presented token by its hash.
select id, user_id, family_id, expires_at, revoked_at
from refresh_tokens
where token_hash = $1
for update;

--  No row                  -> 401, nothing else to do.
--  revoked_at is not null   -> REUSE DETECTED. Run 6b, then 401.
--  expires_at < now()       -> 401, session genuinely expired.
--  Otherwise                -> 6c.


-- 6b. REUSE DETECTED: a token that was already rotated came back.
--     Either the thief or the real user is holding a stale copy, so
--     assume theft and kill the whole family.
update refresh_tokens
set revoked_at = now()
where family_id = $1
  and revoked_at is null;


-- 6c. Normal rotation: burn the old row, insert its successor with the
--     SAME family_id and a fresh 60-day window (this is the "sliding"
--     part that keeps users logged in indefinitely).
update refresh_tokens
set revoked_at = now(),
    last_used_at = now()
where id = $1;

insert into refresh_tokens
  (user_id, token_hash, family_id, expires_at, user_agent, ip)
values
  ($2, $3, $4, now() + interval '60 days', $5, $6)
returning id, expires_at;

commit;

-- Guard this endpoint in Node with a per-user lock. Four screens firing
-- at once on app open will all get a 401 and all call refresh; without a
-- lock the first rotates and the other three present a burned token,
-- which your own reuse detection then reads as theft -- logging the user
-- out on app open.


-- =====================================================================
-- 7. LOGOUT
-- =====================================================================

-- 7a. This device only.
update refresh_tokens
set revoked_at = now()
where token_hash = $1
  and revoked_at is null;

-- 7b. All devices ("log out everywhere", password change).
update refresh_tokens
set revoked_at = now()
where user_id = $1
  and revoked_at is null;

-- 7c. Active sessions list, for a settings screen.
select id, user_agent, ip, created_at, last_used_at
from refresh_tokens
where user_id = $1
  and revoked_at is null
  and expires_at > now()
order by last_used_at desc nulls last;


-- =====================================================================
-- 8. ADDRESSES
-- =====================================================================

-- 8a. List a user's addresses, default first.
select id, label, flat_unit, society, area, city, state, pincode,
       landmark, latitude, longitude, is_default
from addresses
where user_id = $1
  and deleted_at is null
order by is_default desc, created_at desc;

-- 8b. Add one. If it is the first address, make it the default.
insert into addresses
  (user_id, label, flat_unit, society, area, city, state, pincode, landmark,
   is_default)
values
  ($1, $2, $3, $4, $5, $6, $7, $8, $9,
   not exists (select 1 from addresses
               where user_id = $1 and deleted_at is null))
returning id;

-- 8c. Change the default. Clear then set, one transaction --
--     idx_addresses_one_default rejects the second row otherwise.
begin;

update addresses
set is_default = false
where user_id = $1
  and is_default
  and deleted_at is null;

update addresses
set is_default = true
where id = $2
  and user_id = $1
  and deleted_at is null;

commit;

-- 8d. Soft delete an address.
update addresses
set deleted_at = now(),
    is_default = false
where id = $1
  and user_id = $2;


-- =====================================================================
-- 9. DISABLE / RE-ENABLE AN ACCOUNT  (admin action)
-- =====================================================================

begin;

update users
set status = 'disabled',
    disabled_at = now(),
    disabled_reason = $2
where id = $1
  and deleted_at is null;

-- Revoke sessions in the SAME transaction. Skip this and the user keeps
-- working normally for up to an hour, until their access token expires.
update refresh_tokens
set revoked_at = now()
where user_id = $1
  and revoked_at is null;

commit;


-- Re-enable.
update users
set status = 'active',
    disabled_at = null,
    disabled_reason = null
where id = $1
  and status = 'disabled';


-- =====================================================================
-- 10. SOFT DELETE  (user-initiated)
-- =====================================================================

-- 10a. Mark deleted. Data is retained during a grace period so the user
--      can change their mind.
begin;

update users
set status = 'deleted',
    deleted_at = now()
where id = $1
  and deleted_at is null;

update refresh_tokens
set revoked_at = now()
where user_id = $1
  and revoked_at is null;

commit;


-- 10b. Restore within the grace window.
update users
set status = 'active',
    deleted_at = null
where id = $1
  and deleted_at > now() - interval '30 days';


-- 10c. After the grace window: anonymize, but KEEP the row.
--      Deleting the row would cascade away or break every booking,
--      order and invoice that references this user. Blanking the
--      personal fields satisfies the deletion request; the row stays
--      as a tombstone so foreign keys still resolve.
update users
set email         = 'deleted+' || id || '@invalid',
    password_hash = '',
    full_name     = null,
    business_name = null
where deleted_at < now() - interval '30 days'
  and email not like 'deleted+%@invalid';

update addresses
set deleted_at = coalesce(deleted_at, now()),
    flat_unit = '', society = null, area = '', city = '',
    state = null, pincode = null, landmark = null,
    latitude = null, longitude = null
where user_id in (
  select id from users
  where deleted_at < now() - interval '30 days'
);


-- =====================================================================
-- 11. CLEANUP  (nightly cron)
-- =====================================================================

-- Consumed and expired codes pile up quickly. Keep a week for debugging.
delete from email_verification_codes
where created_at < now() - interval '7 days';

-- Revoked and expired tokens.
delete from refresh_tokens
where expires_at < now() - interval '30 days'
   or (revoked_at is not null and revoked_at < now() - interval '30 days');
