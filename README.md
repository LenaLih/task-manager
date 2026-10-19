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
