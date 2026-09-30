# padosipro-be-home

JSON REST API for PadosiPro: email sign-up with OTP, JWT auth, user profile and addresses.

**Stack:** TypeScript 7 · Express 5 · PostgreSQL · Sequelize 6 · native ESM

## Requirements

- **Node.js 24** (developed and tested on v24.21.0)
- **PostgreSQL** with the `citext` and `pgcrypto` extensions available
- A **Brevo** API key for sending OTP emails

## Setup

```bash
npm install
cp .env.example .env        # fill in DB credentials and secrets
```

Generate the secrets with `openssl rand -hex 32` for `OTP_PEPPER` and `JWT_ACCESS_SECRET`.

Apply the migrations in order (skip `002_queries.sql`, which is reference SQL only):

```bash
set -a; source .env; set +a
for f in 001_schema 003_add_phone_to_users 004_address_line_and_notes; do
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -f "migrations/$f.sql"
done
```

See [migrations/README.md](migrations/README.md) for the rules on adding new ones.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with `tsx watch` (no type-checking) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile `src/` to `dist/` |
| `npm start` | Run `dist/server.js` (build first) |
| `npm test` | Integration tests (needs the migrated DB from `.env`) |

The server checks the DB connection before listening on `PORT` (default `3000`).

## Environment

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT` | Runtime mode and port |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_LOGGING` | PostgreSQL connection |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | Transactional email |
| `OTP_PEPPER` | HMAC secret for hashing OTP codes |
| `JWT_ACCESS_SECRET` | Signs access tokens |

## API

Base path: `/api`. All bodies are JSON.


### Response format

Every response uses the same envelope:

```jsonc
// success
{ "success": true, "statusCode": 200, "message": "Profile", "data": { ... } }

// error
{ "success": false, "statusCode": 400, "message": "flatUnit is required",
  "error": { "code": "BAD_REQUEST", "details": { ... } } }
```

Common status codes: `400` invalid input, `401` bad credentials or token, `403` suspended/unverified account, `404` not found, `409` email or phone taken, `429` too many login attempts (5 per email+IP per 15 min).

### Tokens

- **Access token:** JWT, valid 1 hour.
- **Refresh token:** opaque, valid 60 days, rotated on every refresh. Reusing a revoked token revokes its whole family.
- **OTP:** 6 digits, valid 10 minutes, max 5 attempts.

## Project structure

```
src/
  app.ts            Express app (import this in tests)
  server.ts         Entry point: connects to DB, then listens
  config/           Typed env config and Sequelize instance
  routes/           One router per feature, mounted under /api
  controllers/      Pick status + message, send the envelope
  services/         Business logic, return plain data
  models/           Sequelize models (register in models/index.ts)
  middlewares/      authenticate, notFound, errorHandler
  utils/            ApiError, response helpers
migrations/         Numbered, forward-only SQL files
test/               node:test integration tests
```
