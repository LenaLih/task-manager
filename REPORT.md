# Отчёт о реализации

## Созданы

- `server/app.ts`, `server/index.ts`, `server/tsconfig.json` — Express REST API, SQLite, авторизация, настройки и запуск.
- `server/app.test.ts` — интеграционные проверки backend.
- `src/store/auth.ts`, `src/store/api.ts`, `src/store/index.ts` — Redux, RTK Query, refresh/mutex и кеш.
- `src/store/api.test.ts` — тесты клиентских запросов и сессии.
- `src/components/AuthPage.tsx`, `src/components/ProtectedRoute.tsx`, `src/components/TaskManager.tsx` — страницы авторизации, защита маршрута и подключённый к API прежний интерфейс задач.
- `src/components/AuthPage.test.tsx`, `src/components/Tasks.test.tsx` — проверки маршрутизации и компонентов.
- `scripts/setup.mjs`, `.env.example`, `vitest.config.ts` — настройка проекта и тестирование.
- `.env` — локальные случайные учебные ключи, файл исключён из Git.
- `REPORT.md` — этот отчёт.

## Изменены

`src/App.tsx`, `src/main.tsx`, `src/App.css`, `src/components/TaskForm.tsx`, `src/components/TaskList.tsx`, `src/components/TaskItem.tsx`, `package.json`, `package-lock.json`, `tsconfig.app.json`, `vite.config.ts`, `eslint.config.js`, `.gitignore`, `README.md`.

## Реализовано

Регистрация, вход, восстановление сессии и выход; личные задачи и полный REST CRUD; защищённый маршрут; RTK Query с providesTags/invalidatesTags; автоматический refresh после 401 и mutex; очистка авторизации и кеша с переходом на login при отказе refresh; loading/error/empty states; оптимистическое изменение статуса с undo.

Сохранены исходные стили, фильтры, прогресс и редактирование по Enter/двойному клику. Черновик новой задачи сохраняется при неуспешном создании, повторные действия во время записи блокируются.

Пароли: bcrypt cost 12, защита от усечения длинного UTF-8 пароля. Access хранится в памяти Redux. Refresh: JWT, HttpOnly/SameSite=Strict-cookie, Secure в production, хеш в SQLite, одноразовая ротация и отзыв при выходе. На backend все обращения к задачам проверяют владельца. Дополнительно настроены Helmet, Origin-проверка, лимиты запросов и валидация Zod. TypeScript frontend и backend — strict; явного any в добавленном коде нет.

## Результаты проверок

- `npm run build` — успешно: frontend и backend собраны, финальный JS bundle около 351 KB (113 KB gzip).
- `npm run lint` — успешно.
- `npm test` — 4 файла, 13 тестов успешно.
- `npm run setup` — успешно создан игнорируемый `.env`.
- При установке npm сообщил 0 уязвимостей.

Backend: конфигурация ключей и Secure-cookie; хеширование, вход, ошибочный пароль и дубликат email; CRUD и изоляция двух пользователей; ротация и logout; истёкший access, недействительный refresh, отсутствие авторизации, неверный Origin и невалидные данные.

Frontend: очистка сессии; один refresh для конкурентных 401 и повтор запросов с новым access; очистка приватного кеша; оптимистическое обновление и откат; повторная загрузка по tags; реальное перенаправление защищённого маршрута после очистки сессии; сохранение/очистка черновика; empty state и блокировка незавершённых изменений.

## Ограничения

Совместный `npm run dev` не подтверждён: в песочнице tsx получил `uv_os_get_passwd / ENOMEM`, запрос запуска вне песочницы был отклонён пользователем. Backend HTTP-поведение проверено через Supertest. Браузерные E2E и визуальное сравнение не выполнялись.

Нет восстановления пароля, подтверждения email, пагинации, межвкладочного mutex и интерфейса управления всеми сессиями. Выпущенный access действует до истечения 15 минут после logout. Старые localStorage-задачи не мигрируют автоматически и не удаляются. Production требует HTTPS и общего origin для frontend/API; инструкции приведены в README. Работа выполнялась в D:\codex-practice, код не публиковался, облачные сервисы и глобальные настройки не использовались.
