# Task Manager «ясно.»

Локальное fullstack-приложение: React + TypeScript + Redux Toolkit/RTK Query, Express 5 + TypeScript, SQLite. Node.js 24 LTS.

## Запуск

Все команды выполняйте из `D:\codex-practice`:

```powershell
npm install
npm run setup
npm run dev
```

Откройте **http://localhost:5173** (именно localhost: Origin проверяется сервером). API слушает `127.0.0.1:3001`, Vite проксирует `/api`. Зарегистрируйте пользователя. SQLite создаётся в `data/tasks.sqlite`. `setup` генерирует два независимых случайных ключа в игнорируемом `.env`, существующий файл не перезаписывает. Вместо setup можно заполнить `.env` по `.env.example`; ключи должны отличаться и содержать минимум 32 символа.

```powershell
npm run build
npm run lint
npm test
npm run start:api
```

`start:api` запускает собранный backend. Для production статические файлы `dist/` и `/api` должны обслуживаться под одним HTTPS origin через reverse proxy; frontend fallback должен возвращать `index.html` для `/login` и `/register`. Установите `NODE_ENV=production` в окружении сервера (включает Secure-cookie) и `APP_ORIGIN` в точный origin. Не добавляйте `NODE_ENV=development` в общий `.env`: Vite использует его и при сборке.

## Структура

- `src/components/TaskManager.tsx` — исходный дизайн, фильтрация и прогресс, loading/error/empty states, вызовы API.
- `TaskForm`, `TaskList`, `TaskItem`, `TaskFilters` — небольшие компоненты списка; во время записи повторные действия с задачей блокируются.
- `AuthPage`, `ProtectedRoute` — вход/регистрация и реактивное перенаправление на login после завершения сессии.
- `src/store/auth.ts` — access token и пользователь только в памяти.
- `src/store/api.ts` — типизированные endpoints, tags, mutex, retry после 401, оптимистический статус и undo при ошибке.
- `src/store/index.ts` — Redux store и типизированные hooks.
- `server/app.ts` — фабрика Express-приложения, валидация Zod, авторизация, REST API, SQLite schema.
- `server/index.ts` — настройки окружения, запуск и корректное закрытие БД.
- `scripts/setup.mjs`, `.env.example` — локальная конфигурация без сохранённых в исходниках секретов.
- `server/app.test.ts`, `src/store/api.test.ts`, `src/components/*.test.tsx` — интеграционные и unit-тесты.

## REST API

Для изменяющих запросов обязателен заголовок `Origin`, совпадающий с `APP_ORIGIN`. Задачи требуют `Authorization: Bearer <accessToken>`.

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password }`, ответ `{ user, accessToken }`, HttpOnly-cookie |
| POST | `/api/auth/login` | Аналогичный формат |
| POST | `/api/auth/refresh` | Cookie, ротация refresh и новый access token |
| POST | `/api/auth/logout` | Отзыв текущего refresh token, очистка cookie, 204 |
| GET | `/api/tasks` | Личный список задач |
| GET | `/api/tasks/:id` | Одна задача |
| POST | `/api/tasks` | `{ title, completed? }`, 201 |
| PATCH | `/api/tasks/:id` | `{ title?, completed? }` |
| DELETE | `/api/tasks/:id` | Удаление, 204 |

Задача: `{ id: string, title: string, completed: boolean }`. Название: 1–300 символов после trim. Пароль: минимум 10 символов и максимум 72 байта UTF-8, чтобы избежать усечения bcrypt. Неизвестные поля задачи отклоняются. Ошибки возвращаются как `{ message: string }`.

## Авторизация и безопасность

Пароли хешируются bcrypt с cost 12. Access JWT действует 15 минут, refresh JWT — 7 дней. Refresh хранится в HttpOnly, SameSite=Strict-cookie с ограниченным Path; в БД хранится только SHA-256 хеш токена. Refresh одноразовый: при успешном использовании заменяется новым. Logout отзывает текущую refresh-сессию. Проверяются подпись, алгоритм HS256, issuer, audience, тип и срок JWT.

Каждый SELECT/UPDATE/DELETE задачи ограничен `user_id` из проверенного access JWT; чужая задача возвращает 404. SQL параметризован. Есть Helmet, лимит JSON 16 KB, rate limit для регистрации/входа, проверка Origin против CSRF, Secure-cookie в production. `.env`, SQLite, зависимости и результаты сборки исключены из Git.

На старте один refresh восстанавливает сессию, в том числе при React StrictMode. При 401 mutex допускает только один refresh, остальные запросы ждут и повторяются с новым токеном. Поздний 401 со старым токеном использует уже обновлённый access. Неуспешный refresh очищает авторизацию и весь кеш задач, защищённый маршрут перенаправляет на login. После успешной записи tags обновляют список. При переключении статуса кеш меняется сразу; ошибка восстанавливает прежнее значение, выводится сообщение.

Реализация refresh/mutex сверена с [официальной документацией RTK Query](https://redux-toolkit.js.org/rtk-query/usage/customizing-queries).

## Проверки и границы

Тесты проверяют хеширование, вход и ошибки регистрации, cookie flags, CRUD, отсутствие доступа к чужим задачам, истёкший access, недействительный refresh, ротацию и logout, валидацию и Origin; на frontend — конкурентный refresh, очистку кеша, optimistic undo, tag invalidation, переход на login, empty state и сохранение черновика при ошибке.

Учебные ограничения: нет восстановления пароля, подтверждения email, пагинации и управления всеми сессиями. Уже выпущенный access token остаётся действителен до истечения 15 минут после logout; отзывается refresh. Mutex действует в одной вкладке, межвкладочная координация не реализована. Старые задачи из localStorage автоматически не переносятся и не удаляются. Браузерные E2E и визуальное сравнение скриншотов не выполнялись; проверены React-компоненты и HTTP API. Внешние облачные сервисы не используются.

## PostgreSQL: stage 1 (optional local database)

The Express API still uses SQLite (`DATABASE_PATH`). PostgreSQL is prepared but
is not connected to the routes yet. Existing SQLite files, JWT authentication
and frontend behavior are unchanged. No SQLite data is imported automatically.

Requirements: Node.js 24, installed npm dependencies, and Docker Desktop running
with Linux containers and Docker Compose v2. PostgreSQL does not need to be
installed on the host.

1. Keep the existing `.env` and JWT secrets. Add the `DATABASE_URL` and optionally
   `POSTGRES_PASSWORD` values from `.env.example`. Do not overwrite your `.env`.
2. Start the local database: `docker compose up -d --wait postgres`.
3. Apply migrations: `npm run db:migrate`.
4. Run the same command again: it should report `Database is up to date`.
5. Start the existing SQLite application as before: `npm run dev`.

The default connection URL is for local development only:
`postgresql://task_manager:task_manager_local_only@127.0.0.1:5432/task_manager?sslmode=disable`.
Port 5432 is bound only to localhost. If that port is occupied, adjust both the
Compose host port and `DATABASE_URL`. If changing the Docker password, update
both `POSTGRES_PASSWORD` and the URL (URL-encode special characters). The image
initialization variables only take effect when the data volume is empty; they
do not reset the password in an existing database.

Data persists in the Compose `postgres_data` volume. Stop without deleting data:
`docker compose down`. Do not add `--volumes` unless intentionally deleting data.

SQL migrations live in `migrations/` and use zero-padded filenames such as
`001_initial.sql`. They run in a transaction on one connection, with an advisory
lock and a `schema_migrations` journal. Applied files must not be edited or
removed; add a new migration instead. A failed batch rolls back. Transactional
migrations must not contain their own BEGIN/COMMIT or nontransactional commands
such as CREATE INDEX CONCURRENTLY. Concurrent runners wait for the lock, with a
15-second lock timeout. The runner does not provide an automatic down migration.

The initial schema keeps text IDs, password and refresh-token hashes, foreign
keys, and epoch-millisecond session expiry (`BIGINT`). Task completion uses
`BOOLEAN`, and `position` explicitly prepares for replacing SQLite rowid order.
The migration creates tables, not copies of SQLite data.

Production migrations after `npm run build` can use
`npm run db:migrate:production`. The deployed artifact must include the root
`migrations/` directory alongside `dist-server/`. Migration credentials need DDL
permissions; the future API role should use fewer privileges. The pool reads TLS
settings from `DATABASE_URL`, never disables certificate verification globally,
and is only created when explicitly requested. Use endpoint-appropriate TLS
settings in deployment; the example's disabled TLS is for local Docker only.
Never put database credentials into frontend environment variables or Git.

Checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
docker compose config --quiet
docker compose ps
npm run db:migrate
npm run db:migrate:production
docker compose exec postgres psql -U task_manager -d task_manager -c '\dt'
```

## PostgreSQL backend (stage 2)

This section supersedes the SQLite/stage-1 startup instructions above. The
primary `npm run dev`, `npm run dev:api` and `npm run start:api` now use PostgreSQL.
The API requires `DATABASE_URL`; it does not fall back to SQLite silently.
Start Docker PostgreSQL, set DATABASE_URL in the existing .env, keep the same JWT
secrets and APP_ORIGIN, run `npm run db:migrate`, then `npm run dev`.
Open http://localhost:5173. API routes and response shapes are unchanged.
An existing SQLite account does not appear in PostgreSQL automatically: no
SQLite user, task or session data has been imported or deleted.

Registration and refresh token rotation are transactional. Cookies are issued
only after commit; database failures produce server errors, not authentication
401 responses. Task access remains scoped to the verified JWT user. Partial
updates are atomic and task lists use the explicit position column.

### Integration tests: dedicated database only

Create a separate local database once (not the application database):

```powershell
docker compose exec postgres createdb -U task_manager task_manager_test
$env:TEST_DATABASE_URL = 'postgresql://task_manager:task_manager_local_only@127.0.0.1:5432/task_manager_test?sslmode=disable'
npm test
npm run typecheck
npm run lint
npm run build
```

Adapt the URL if using different local credentials/ports. Tests apply migrations
to this test database and truncate its users/tasks/sessions between cases.
The database name must end with `_test` and differ from DATABASE_URL's database.
Never point TEST_DATABASE_URL to a database whose contents you need to keep.
Without TEST_DATABASE_URL, the PostgreSQL API suite is skipped; mocked migration
and frontend suites do not connect to any database. No test creates a database
automatically or resets the main application's data.

### SQLite rollback

The old backend is preserved in server/sqlite-app.ts and server/sqlite-index.ts.
SQLite dependencies and DATABASE_PATH remain; existing SQLite files are untouched.
To roll back locally, stop the PostgreSQL API, run `npm run dev:api:sqlite` in one
terminal and `npx vite --host 127.0.0.1` in another. After a build the equivalent
backend command is `npm run start:api:sqlite`. Keep the original JWT secrets.
This returns to the original SQLite data only: new PostgreSQL writes are not
copied back. Keep a consistent SQLite backup (including WAL state if copying a
live database) before any future import. The PostgreSQL migration 001 is unchanged.

## Next.js infrastructure (stage 1)

The default `npm run dev` starts Next.js on http://localhost:3000 and the existing
Express API on 127.0.0.1:3001. The launcher overrides APP_ORIGIN for that API
process to http://localhost:3000; it does not edit .env or JWT settings.
PostgreSQL must already be running and DATABASE_URL must be configured.
Optional launcher variables: NEXT_PORT (3000), API_PORT (3001), NEXT_APP_ORIGIN.

Next routes `/`, `/login` and `/register` are server-rendered placeholders with
the existing CSS and working Next links. Task operations, forms, Redux providers
and authentication bootstrap have intentionally NOT been connected to these
pages yet. The Next module tree does not import the legacy global store or make
user-data requests. Only public placeholder content can be cached.

Next forwards `/api/*` to Express, retaining the `/api` prefix. Configure
API_INTERNAL_ORIGIN before building if Express uses a different address; its
default is http://127.0.0.1:3001. No API/JWT secrets are exposed as NEXT_PUBLIC
variables. The backend remains solely responsible for authentication.

```powershell
npm run dev                 # Next placeholders + Express, localhost:3000
npm run dev:vite            # Original working UI + Express, localhost:5173
npm run dev:next            # Next only; start API separately if needed
npm run typecheck
npm run lint
npm test                   # API suite requires separate TEST_DATABASE_URL
npm run build               # Next + Express
npm run build:vite          # Legacy Vite + Express
npm run start:next          # Built Next pages, port 3000
```

Do not run both combined dev commands simultaneously: they both start Express
on port 3001 and require different APP_ORIGIN values. Stop one before switching.
The unchanged dev:api command reads APP_ORIGIN from .env (legacy default 5173).
For separately launched Next/API processes set APP_ORIGIN=http://localhost:3000
for Express, without overwriting existing JWT secrets.

The custom tsconfig.next.json isolates Next app types from the retained Vite
project references and server NodeNext settings. next-env.d.ts and .next are
Next-generated artifacts and ignored by Git. Vite, React Router and the existing
components/tests remain installed and unchanged. This step does not add a
production process supervisor or complete the migration of the application.

## Next.js client authentication (stage 2)

The root client Providers component creates a separate Redux store and auth
coordinator for its tree. Next modules do not import the Vite-only singleton
(src/store/legacy.ts). Authentication requests run after mount in AuthBootstrap,
not in Server Components or during static generation. Only public shells are
server-rendered/cached; user tokens are not serialized into server page props.

`/login` and `/register` now render the existing authentication form using Next
navigation. `/` is guarded and still shows a task-migration placeholder, with the
current email and a logout button. The task list has not been connected to Next.

A refresh promise and mutex are scoped to each store. StrictMode effect replay
reuses an in-flight refresh rather than rotating twice. Confirmed refresh 401
clears the session and private RTK cache; 500/network errors retain the session
and show a retry button. Logout invalidates old response revisions immediately,
waits for an in-flight cookie rotation and then revokes that cookie. Refresh
cannot start during logout; stale refresh/login responses cannot write auth
state. Failed logout keeps the local session and offers retry. Access JWT remains
in memory, and the HttpOnly refresh cookie remains owned by Express.

The Vite application remains available via `npm run dev:vite`, using its legacy
React Router form/entrypoint; Next uses `npm run dev`. Do not run both combined
launchers simultaneously. The mutex coordinates a single store, not different
browser tabs. Browser cookie delivery/revocation still depends on the server
response. Login/registration and refresh use the same mutex, so logout waits
for their Set-Cookie responses before revoking the session. Broader cross-tab
or session-family coordination is not part of this stage.

Checks: `npm run typecheck`, `npm run lint`, `npm run build`,
`npm run build:vite`, and `npm test -- --maxWorkers=1` with a separate
TEST_DATABASE_URL ending in `_test`. New tests cover bootstrap StrictMode replay,
401 redirect, 500/network retry, per-tree isolation, login/registration, concurrent
refresh, logout ordering and stale session responses.

## Next.js task interface (stage 3)

The guarded `/` route now reuses TaskManager, TaskForm, TaskList, TaskItem and
TaskFilters with the same CSS and responsive layout. Next no longer renders
the migration placeholder or a second account toolbar on this route.

Tasks are fetched in the browser only after auth initialization succeeds.
No Server Component fetches private data. A fresh page mount restores the
HttpOnly-cookie session and then refetches `/api/tasks` from Express/PostgreSQL.
The API, database schema and migration files are unchanged.

Existing RTK Query tags, mutation invalidation and optimistic status updates
with rollback remain in place. Load failures show the existing retry button;
create/edit/delete failures keep their existing messages and behavior.

A store middleware resets private RTK state on clearSession or an identity
change, before publishing the new identity. Same-user access-token refresh does
not reset task data. Old in-flight responses cannot replace a new account's
cache. AuthGuard keys its private subtree by user ID so local filters, drafts
and mutation errors do not survive account changes. Logout cache cleanup is
centralized rather than repeated inside TaskManager.

Run `npm run dev` and open http://localhost:3000. Test login, task creation,
editing by double click/Enter, completion, all three filters, deletion, page
reload and logout. `npm run dev:vite` still runs the legacy UI for comparison;
do not run both combined launchers simultaneously on API port 3001.

Validation commands: `npm run typecheck`, `npm run lint`,
`npm test -- --maxWorkers=1` (with dedicated TEST_DATABASE_URL),
`npm run build`, `npm run build:vite`.
The new UI integration tests mock fetch; PostgreSQL persistence and ownership
are separately verified by the existing server integration suite. Hydration
is checked in jsdom; real-browser end-to-end/visual checks remain separate.

## Real-browser E2E (Playwright)

Requirements: local PostgreSQL running in Docker, separate database
`task_manager_e2e`, Node dependencies, and Playwright Chromium.
The existing `.env` and its JWT secrets are never rewritten by E2E.

```powershell
# Run once if the database does not exist:
docker compose exec postgres createdb -U task_manager task_manager_e2e
npm run test:e2e:install
npm run test:e2e
```

`npm run test` / `npm test` still runs Vitest (use a separate task_manager_test
for its PostgreSQL suite). `npm run test:e2e` verifies the E2E database, applies
existing migrations there and starts Playwright. Both the launcher and API
bootstrap reject non-local connections, a database name other than
`task_manager_e2e`, or a DATABASE_URL naming that same database. The actual
`current_database()` is checked before any migration. No tables are truncated,
no existing user data is deleted, and every test gets random unique accounts.
Test users/tasks remain only in the E2E database for debugging.

By default E2E derives task_manager_e2e from local DATABASE_URL credentials.
Alternatively set E2E_DATABASE_URL explicitly to a localhost URL naming exactly
that database. Do not point the main application DATABASE_URL at the E2E database.

Playwright starts its own Express API at 127.0.0.1:3201 and Next.js at
http://localhost:3200. Existing servers are never reused. Next uses .next-e2e
so the normal dev build stays separate. The E2E API generates ephemeral JWT
secrets in memory and retains the original JWT/cookie implementation. It uses
only task_manager_e2e; main app startup files and routes are unchanged.

Four scenarios run in two Chromium projects (desktop 1280x900, mobile 390x844):
registration/login/logout/F5, task CRUD/filtering/persistence, field validation
and generic bad credentials, and isolation of two accounts plus an actual
foreign-task 404. Each scenario monitors page errors and critical console errors,
including hydration, and checks relevant responsive layout. Expected API 401
resource messages and external Google Fonts load failures are excluded from
console diagnostics; JavaScript exceptions and hydration errors are not excluded.
These are Chromium tests with viewport/touch emulation, not a real mobile device
or Safari/Firefox coverage. Auth and CRUD requests hit the real Express/Postgres
stack; no application API is mocked.

Reports: playwright-report/index.html; failed-test screenshots, video and traces
in test-results/. Browser binaries are in .playwright-browsers/. These, .next-e2e
and blob-report are ignored by Git. Reports/traces can contain test-only cookies
and credentials: do not publish them unreviewed.

For one project: `npm run test:e2e -- --project=desktop-chromium`.
Use `npm run test:e2e -- --headed` to inspect the real browser interactively.

## GitHub Actions CI

Workflow `.github/workflows/ci.yml` runs on pull requests to `main` and pushes to
`main`. It uses Node.js 24 LTS, `npm ci`, and a disposable PostgreSQL 17 service.
It creates and migrates `task_manager_test` and `task_manager_e2e` separately.
The `postgres` database is used only to bootstrap the service; tests never reset it.
No local `.env`, production credentials, or Neon connection is used in CI.
JWT secrets in the workflow environment are public test-only values and must never
be reused outside tests. CI fails if integration test configuration is missing.

The checks run TypeScript, ESLint, unit/integration tests, production Next.js and
Express builds, then Chromium E2E tests for desktop and mobile. E2E currently
starts the Next.js development server, as configured locally; the production
build is checked separately. Chromium system dependencies are installed on Ubuntu.
Failed E2E runs upload HTML reports, screenshots, videos and traces for seven days.
Every check is blocking; newer runs cancel obsolete runs for the same PR/branch.
Local npm commands are unchanged. Workflow execution, Linux dependencies and
artifact upload must be verified in GitHub Actions after publishing the branch
and opening a PR to `main`. No deployment is performed by this workflow.

### Dependency audit

The current audit reports five high entries from one development dependency chain:
`eslint-config-next@16.4.2 -> @next/eslint-plugin-next@16.4.2 -> fast-glob@3.3.1 -> micromatch@4.0.8 -> braces@3.0.3`.
The underlying advisory is
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
(stack exhaustion with deeply nested patterns). `npm audit --omit=dev` reports no
production dependency vulnerabilities. This does not make linting untrusted
patterns risk-free.

At the time of this check, npm lists `braces@3.0.3` as the latest version, with no
patched release available. The automatic suggestion to use
`eslint-config-next@14.2.35` crosses major versions and is not applied.
Safe follow-up: upgrade within Next.js 16 when its lint dependency chain is fixed,
or use a narrowly scoped override once a compatible patched `braces` release
exists, then rerun lint, typecheck, tests and builds. Until then, monitor the
advisory and keep lint execution isolated with read-only repository permissions
and without production secrets. Audit is reported separately rather than silently
ignored by a failing CI audit step. No `npm audit fix --force` or dependency
version changes were made for this CI setup.

## Production launcher (Render Free preparation)

Build with `npm ci --include=dev` and `npm run build`, then run `npm start`
(or `node scripts/start-production.mjs`). Configure environment variables externally;
the launcher intentionally does not load the development `.env` file.
Required: `PORT`, `APP_ORIGIN`, `DATABASE_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`. JWT secrets must be distinct and at least 32 characters.
Use the exact public HTTPS origin without a trailing slash. HTTP localhost is
allowed for smoke tests. Set `API_INTERNAL_ORIGIN=http://127.0.0.1:3001` during
both build and runtime; the production Next configuration rejects other targets.
The public PORT must differ from 3001.

Startup runs the compiled migration CLI, starts Express on loopback port 3001,
waits for its health endpoint, and then starts Next on `0.0.0.0:$PORT`.
Keep the `migrations/` directory with the build output. Migration failures block
startup. SIGTERM/SIGINT cancel startup or stop both servers; the launcher waits
for children and escalates after 15 seconds. Express closes its PostgreSQL pool
and has its own 10-second shutdown deadline. Unexpected child exits are fatal.
A pending migration is also supervised and terminated on shutdown.

Render Health Check Path: `/api/health`. It passes through Next rewrites to
Express and returns only `{ "status": "ok" }`, without a database query.
The API checks PostgreSQL before listening. All `/api` responses use
`Cache-Control: no-store`. Production cookies retain HttpOnly, Secure,
SameSite=Strict and Path=/api/auth; state-changing requests require APP_ORIGIN.
JWT/DB credentials are removed from the Next subprocess environment. Never
commit `.env` or configure credentials through NEXT_PUBLIC_* or next.config env.
Use Render environment settings and TLS for the external PostgreSQL connection.

Express trusts only the immediate loopback Next proxy (hop zero), not arbitrary
forwarded hops. Rate limiting uses the rightmost forwarded address. This is a
conservative baseline: on Render it may identify an ingress proxy and group
users together. Verify Render's actual forwarded-header chain and spoofed XFF
behavior before public release; do not switch to unconditional trust proxy=true
or blindly trust a fixed count of hops. Next currently preserves incoming XFF.
No IP diagnostic endpoint or infrastructure secrets are publicly exposed.

`npm test` includes launcher lifecycle tests. After building, run
`npm run test:production` with TEST_DATABASE_URL explicitly set to local
`task_manager_test`. The smoke test passes this URL to the production launcher
as DATABASE_URL and rejects other hosts/database names. It checks unavailable
PostgreSQL, real production rewrites, Origin rejection, cookie rotation,
private response headers and bearer authorization. It creates a uniquely named
user only in that test database and does not clean or touch the application DB.
The CI workflow runs this check after the production build. On Linux it also
checks the real SIGTERM exit code; Windows uses taskkill to clean the test
process tree because its kill API does not deliver POSIX signals. Unit tests
cover graceful signal handling on every platform. Browser enforcement of Secure
cookies and actual Render ingress/IP behavior still require HTTPS/Render checks.
Local Vite/Next development commands and database schema are unchanged.
