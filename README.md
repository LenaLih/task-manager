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
