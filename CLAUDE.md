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

There's no test runner or linter yet. `npm test` is the npm placeholder and always exits with an error.

## Architecture

The request flow is `app.ts` → `/api` → `routes/index.ts` → feature router → controller → model. Anything unmatched falls through to `middlewares/notFound.ts`, then to `middlewares/errorHandler.ts`.

- **config/**: `index.ts` loads `.env` (dotenv) and default-exports one typed `config` object. Read env values through it, not through `process.env` directly. `database.ts` exports the single Sequelize instance.
- **models/**: each model file should export an init function `(sequelize) => ModelStatic`. It can define an optional static `associate(models)`. Register every model in `models/index.ts`, which runs all the `associate` calls. Import models from `models/index.js`, never from individual files.
- **routes/**: create one `<feature>.routes.ts` per feature and mount it in `routes/index.ts`. Every route lives under the `/api` prefix.
- **controllers/**: create one `<feature>.controller.ts` per feature, typing handlers with Express's `RequestHandler`.
- **Errors**: throw `new ApiError(status, message, details?)` from `utils/ApiError.ts`. Express 5 sends rejected promises from async handlers to the error middleware automatically, so don't use try/catch or asyncHandler wrappers just to forward errors. The error handler hides the message of 5xx errors and omits stack traces when `NODE_ENV=production`.
- **migrations/** (repo root): schema changes live here as plain, numbered, forward-only SQL files (`NNN_description.sql`, each wrapped in `BEGIN; ... COMMIT;`). They are run manually with psql, and no tool tracks what has been applied. Never edit a migration that's already been applied; add a new one. Every schema change needs a migration, and the matching model in `src/models/` must be updated too. Never use `sequelize.sync()`. See `migrations/README.md`.
- **Express 5 path syntax**: wildcards must be named (for example `/*splat`), and path matching is stricter than in Express 4.

## Database schema

`migrations/001_schema.sql` is the source of truth. It has been applied. Each table has a model in `src/models/` (`user`, `address`, `emailVerificationCode`, `refreshToken`). The models use camelCase attributes with `underscored: true`, so they map to snake_case columns. `users` has three one-to-many children: `addresses`, `email_verification_codes` and `refresh_tokens`, all `ON DELETE CASCADE`.

`migrations/002_queries.sql` is **not a migration**. It's the reference SQL for each auth and address flow (register, OTP send/verify, login, token rotation, logout, default address, disable, soft delete, cleanup). Implement services to match it, including its transaction boundaries and check order.

Rules the schema relies on:
- **Primary keys**: every PK is a UUID, generated in Node with `UUIDV4`, which matches the DB default `gen_random_uuid()`.
- **Soft delete**: this is done by hand, not with Sequelize `paranoid`. Filter `deletedAt: null` explicitly. For `users`, set `status = 'deleted'` and `deleted_at` together.
- **Email uniqueness**: `users.email` is `citext`, and it's unique only among rows where `deleted_at` is null (a partial index), not across the whole table. A duplicate raises a unique violation (`23505`).
- **Password hash**: the `User` default scope leaves out `passwordHash`. Use `User.scope('withPassword')` when login needs it.
- **Default address**: only one live address per user can be the default (a partial unique index). Clear the old default before setting a new one, in the same transaction.
- **Verification codes**: `email_verification_codes` is insert-only, with one row per code sent and no `updated_at`. `code_hash` must be bcrypt or HMAC with a pepper, never plain sha256, because a 6-digit code is trivial to brute-force. The `attempt_count` limit is 5.
- **Refresh tokens**: store only the sha256 of the raw token. Rotation revokes the old row and inserts a new one with the same `family_id`. If a revoked token comes back, revoke the whole family.
- **`updated_at`**: a DB trigger (`set_updated_at`) keeps it current on `users` and `addresses`.
- **`addresses.latitude/longitude`**: these are `numeric(9,6)` and come back as strings.
