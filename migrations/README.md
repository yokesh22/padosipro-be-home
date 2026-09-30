# Migrations

Plain SQL files that record every schema change to the PostgreSQL database. They're run **manually**. No tool tracks which ones have been applied.

## Naming

```
NNN_short_description.sql
```

- `NNN` is a zero-padded sequence number, one higher than the latest file (`001`, `002`, ...).
- Use a lowercase snake_case description, e.g. `003_add_phone_to_users.sql`.

## History

| File | Applied | Notes |
|------|---------|-------|
| `001_schema.sql` | yes | Extensions (citext, pgcrypto), `set_updated_at()` trigger, tables `users`, `addresses`, `email_verification_codes`, `refresh_tokens` |
| `002_queries.sql` | n/a | **Not a migration.** Reference SQL for the runtime flows (register, OTP, login, refresh, logout, addresses, disable, soft delete, cleanup). Never run it. |
| `003_add_phone_to_users.sql` | yes | `users.phone_number` (text, NOT NULL, E.164 check) and partial unique index `idx_users_phone_active` on live rows |
| `004_address_line_and_notes.sql` | yes | `addresses.address_line` and `addresses.notes` (text, nullable); `area` and `city` made nullable |
| `005_tasks.sql` | local dev only | Table `tasks` (user's service requests), index `(user_id, status, created_at desc)`, `updated_at` trigger |

## Rules

- **Never edit a migration after it has been applied** to any shared database. To change or undo something, add a new migration.
- Wrap each file in `BEGIN; ... COMMIT;` so a failure leaves the schema untouched.
- Only forward (up) migrations. There are no down scripts.
- Keep the Sequelize models in `src/models/` in sync with the schema. Don't use `sequelize.sync()` to create or alter tables.

## Template

```sql
-- NNN_short_description.sql
-- Why this change is needed.

BEGIN;

-- DDL here

COMMIT;
```

## Running

Apply pending files in order, using the credentials from `.env`:

```bash
set -a; source .env; set +a
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -f migrations/003_add_phone_to_users.sql
```

`-v ON_ERROR_STOP=1` makes psql stop at the first error instead of carrying on.
