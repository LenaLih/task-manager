<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Визуальная проверка интерфейса

1. После любых изменений интерфейса открой затронутые страницы в браузере и визуально проверь их на десктопной и мобильной ширине.
2. Проверь выравнивание, отступы, размеры элементов, адаптивность и отсутствие переполнения контейнеров.
3. Проверь соседние страницы и общие компоненты, которых могут коснуться изменения.
4. HTTP 200, успешная сборка и прохождение тестов не заменяют визуальную проверку в браузере.
5. Если визуальная проверка недоступна, прямо укажи это в итоговом отчёте. Утверждай, что интерфейс визуально проверен, только после проверки в браузере.
6. Исправь выявленные проблемы до завершения задачи и повтори визуальную проверку после исправлений.
