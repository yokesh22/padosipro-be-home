# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`padosipro-be-home` is a JSON-only REST API written in **TypeScript 7** (the native `tsc`), built with **Express 5**, **PostgreSQL** and **Sequelize 6**. It follows MVC without the view layer: controllers return JSON.

The project is **native ESM** (`"type": "module"`, `module: nodenext`, `verbatimModuleSyntax`):
- Relative imports must use the `.js` extension, even from `.ts` files: `import app from './app.js'`.
- Type-only imports must use `import type { ... }`.
- `require`, `module.exports` and `__dirname` are not available.

tsconfig also turns on `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Under `exactOptionalPropertyTypes`, you can't assign `undefined` to an optional property unless its type includes `| undefined`.

## Commands

- `npm install` — install dependencies
- `cp .env.example .env` — then fill in the DB credentials
- `npm run dev` — run `src/server.ts` with `tsx watch` (no type-checking; restarts on changes)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — compile `src/` to `dist/`
- `npm start` — run the compiled `dist/server.js` (build first)

tsx only strips types, so run `npm run typecheck` to catch type errors.

The entry point is `src/server.ts`. It calls `sequelize.authenticate()` before `app.listen`, so the server won't start without a reachable Postgres. `src/app.ts` builds the app without connecting to the DB or listening, which makes it the thing to import in tests (for example with supertest).

`npm test` runs `test/**/*.test.ts` with Node's built-in `node:test` through tsx. These are integration tests: they need the Postgres from `.env` with every migration applied. They create throwaway users with `@example.invalid` emails and hard-delete them at the end. `test/` isn't under tsconfig's `include`, so `npm run typecheck` doesn't check it. There's no linter yet.

## Architecture

The request flow is `app.ts` → `/api` → `routes/index.ts` → feature router → controller → model. Anything unmatched falls through to `middlewares/notFound.ts`, then to `middlewares/errorHandler.ts`.

- **config/**: `index.ts` loads `.env` (dotenv) and default-exports one typed `config` object. Read env values through it, not through `process.env` directly. `database.ts` exports the single Sequelize instance.
- **models/**: each model file should export an init function `(sequelize) => ModelStatic`. It can define an optional static `associate(models)`. Register every model in `models/index.ts`, which runs all the `associate` calls. Import models from `models/index.js`, never from individual files.
- **routes/**: create one `<feature>.routes.ts` per feature and mount it in `routes/index.ts`. Every route lives under the `/api` prefix.
- **controllers/**: create one `<feature>.controller.ts` per feature, typing handlers with Express's `RequestHandler`.
- **Response format**: every response uses the envelope in `utils/apiResponse.ts`. Success: `{ success: true, statusCode, message, data }`, sent from controllers with `sendSuccess(res, status, message, data?)` (`data` defaults to `null`). Error: `{ success: false, statusCode, message, error: { code, details?, stack? } }`, built only by `errorHandler`, where `code` comes from the status (`BAD_REQUEST`, `NOT_FOUND`...). Never call `res.json()` directly. Services return plain data (or nothing). The controller picks the status code and message. Type handlers as `RequestHandler<Params, ApiResponse<Data>, Body>`.
- **Sign-up vs sign-in**: `POST /auth/register` takes `{ email, phoneNumber, password }` (min 8 chars, argon2-hashed) and emails an OTP (202). Re-registering an unverified email replaces its password and phone and sends a new OTP; a verified email or a taken phone gets 409. `POST /auth/verify-email` checks the code and returns tokens plus `user` and `isNewUser`. `POST /auth/login` takes `{ email, password }` and returns tokens, `user` and `needsProfile` (`true` while `fullName` is empty), with no OTP. It returns 401 for a wrong email or password (the same message for both), 403 for a suspended or unverified account (unverified only after the password matches), and 429 after 5 failures per email+IP in 15 minutes (in-memory, `services/loginLimiter.service.ts`). `POST /auth/refresh` rotates the refresh token. `POST /auth/logout` takes `{ refreshToken }` and needs no access token. It revokes every live token in that token's family, so only this device is signed out, and it always returns 204 (even for unknown, expired or revoked tokens) through `sendNoContent`. A missing or non-string token gets 400, the same as refresh.
- **Auth**: protected routes use `middlewares/authenticate.ts`, which verifies `Authorization: Bearer <accessToken>` (JWT) and sets `req.userId`. The logged-in user's own resources live under `/api/users/me` (`GET /users/me`, `PATCH /users/me`, `POST /users/me/addresses`).
- **User object**: every user object in a response (`login` and `verify-email` `data.user`, and `GET`/`PATCH /users/me` `data`) comes from `userService.loadProfile`. It includes `defaultAddress`: the live address with `is_default = true` (`{ id, flatUnit, addressLine, society, notes, isDefault }`, no `createdAt`), or `null`. It adds one query, and the app parses that field name, so don't rename it.
- **Errors**: throw `new ApiError(status, message, details?)` from `utils/ApiError.ts`. Express 5 sends rejected promises from async handlers to the error middleware automatically, so don't use try/catch or asyncHandler wrappers just to forward errors. The error handler hides the message of 5xx errors and omits stack traces when `NODE_ENV=production`.
- **migrations/** (repo root): schema changes live here as plain, numbered, forward-only SQL files (`NNN_description.sql`, each wrapped in `BEGIN; ... COMMIT;`). They are run manually with psql, and no tool tracks what has been applied. Never edit a migration that's already been applied; add a new one. Every schema change needs a migration, and the matching model in `src/models/` must be updated too. Never use `sequelize.sync()`. See `migrations/README.md`.
- **Express 5 path syntax**: wildcards must be named (for example `/*splat`), and path matching is stricter than in Express 4.

## Database schema

`migrations/001_schema.sql` plus later numbered migrations are the source of truth (see the history table in `migrations/README.md` for what has been applied). Each table has a model in `src/models/` (`user`, `address`, `emailVerificationCode`, `refreshToken`). The models use camelCase attributes with `underscored: true`, so they map to snake_case columns. `users` has three one-to-many children: `addresses`, `email_verification_codes` and `refresh_tokens`, all `ON DELETE CASCADE`.

`migrations/002_queries.sql` is **not a migration**. It's the reference SQL for each auth and address flow (register, OTP send/verify, login, token rotation, logout, default address, disable, soft delete, cleanup). Implement services to match it, including its transaction boundaries and check order.

Rules the schema relies on:
- **Primary keys**: every PK is a UUID, generated in Node with `UUIDV4`, which matches the DB default `gen_random_uuid()`.
- **Soft delete**: this is done by hand, not with Sequelize `paranoid`. Filter `deletedAt: null` explicitly. For `users`, set `status = 'deleted'` and `deleted_at` together.
- **Email uniqueness**: `users.email` is `citext`, and it's unique only among rows where `deleted_at` is null (a partial index), not across the whole table. A duplicate raises a unique violation (`23505`).
- **Phone number**: `users.phone_number` is required, stored in E.164 (`+919876543210`), and unique among live rows only (partial index `idx_users_phone_active`, like email).
- **Password hash**: the `User` default scope leaves out `passwordHash`. Use `User.scope('withPassword')` when login needs it.
- **Address fields**: `flat_unit` is required. `address_line` (free text), `notes` (entry instructions), `area` and `city` are optional (migration 004).
- **Default address**: only one live address per user can be the default (a partial unique index). Clear the old default before setting a new one, in the same transaction.
- **Verification codes**: `email_verification_codes` is insert-only, with one row per code sent and no `updated_at`. `code_hash` must be bcrypt or HMAC with a pepper, never plain sha256, because a 6-digit code is trivial to brute-force. The `attempt_count` limit is 5.
- **Refresh tokens**: store only the sha256 of the raw token. Rotation revokes the old row and inserts a new one with the same `family_id`. If a revoked token comes back, revoke the whole family.
- **`updated_at`**: a DB trigger (`set_updated_at`) keeps it current on `users` and `addresses`.
- **`addresses.latitude/longitude`**: these are `numeric(9,6)` and come back as strings.
