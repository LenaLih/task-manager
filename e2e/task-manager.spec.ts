import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { listenForEmailCode } from './local-smtp'

const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() !== 'error' && !/hydration|hydrating/i.test(message.text())) return
      const text = message.text()
      // Expected anonymous/bootstrap and bad-credential HTTP responses are not JS errors.
      if (/^Failed to load resource:.*\b401\b/.test(text)) return
      if (/^Failed to load resource:.*\b(400|403)\b/.test(text) &&
        /\/api\/account\/email(?:\/confirm)?$/.test(message.location().url)) return
      // External Google Fonts availability is not an application correctness signal.
      if (/^Failed to load resource:/.test(text) &&
        /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(message.location().url)) return
      errors.push(text)
    })
    await use()
    expect(errors, 'browser errors, including hydration diagnostics').toEqual([])
  }, { auto: true }],
})

const password = 'E2e-password-123!'
function newEmail() { return `e2e-${randomUUID()}@example.com` }

test('renders one shared brand header on each auth page', async ({ page }) => {
  const fallback = await page.request.get('/favicon.ico')
  expect(fallback.ok()).toBe(true)
  const routes = {
    '/login': 'Вход',
    '/register': 'Регистрация',
    '/forgot-password': 'Восстановление пароля',
    '/reset-password': 'Новый пароль',
  }

  for (const [route, title] of Object.entries(routes)) {
    await test.step(route, async () => {
      await page.goto(route)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await expect(page).toHaveTitle(`ЯСНО. — ${title}`)
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
      await expect(page.getByRole('heading', { name: /^ясно\s*\.$/i })).toHaveCount(1)
      await expect(page.getByText('Меньше шума. Больше фокуса.', { exact: true })).toHaveCount(1)
    })
  }
})

async function register(page: Page) {
  const email = newEmail()
  await page.goto('/register', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/auth/register') && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const data = await response.json() as { accessToken: string }
  await expect(page.getByRole('heading', { name: 'Мой день' })).toBeVisible()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  return { email, token: data.accessToken }
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
}

test('recovers a forgotten password through the local SMTP fixture', async ({ page }) => {
  const mail = await listenForEmailCode()
  try {
    const { email } = await register(page)
    await logout(page)
    await page.getByRole('link', { name: /Забыли пароль/ }).click()
    await expect(page).toHaveTitle('ЯСНО. — Восстановление пароля')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByRole('button', { name: 'Отправить ссылку' }).click()
    await expect(page.getByRole('status')).toContainText('Если аккаунт существует')
    let token: string | undefined
    await expect.poll(() => {
      token ??= mail.takeCode()
      return Boolean(token)
    }).toBe(true)
    await page.goto('/reset-password#token=' + token)
    await expect(page).toHaveTitle('ЯСНО. — Новый пароль')
    const nextPassword = 'E2e-new-password-123!'
    await page.getByLabel('Новый пароль', { exact: true }).fill(nextPassword)
    await page.getByLabel('Повторите пароль').fill(nextPassword)
    await page.getByRole('button', { name: 'Сохранить пароль' }).click()
    await expect(page.getByRole('status')).toContainText('Пароль изменён')
    await expect(page).toHaveURL('/reset-password')
    await page.getByRole('link', { name: 'Вернуться ко входу' }).click()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Пароль', { exact: true }).fill(nextPassword)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Мой день' })).toBeVisible()
  } finally {
    await mail.close()
  }
})

test('finance tracks accounts, movements, budget and goal across reload', async ({ page }, info) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  // Keep the framework's development badge from covering app controls on mobile.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal { visibility: hidden !important; pointer-events: none !important }'
      document.head.append(style)
    }, { once: true })
  })
  await page.goto('/finance')
  await expect(page).toHaveURL('/login')
  await register(page)
  await page.getByRole('navigation', { name: 'Рабочее пространство' }).getByRole('link', { name: 'Финансы' }).click()
  await expect(page.getByRole('heading', { name: 'Финансы' })).toBeVisible()
  const tab = (name: string) => page.getByRole('group', { name: 'Разделы финансов' }).getByRole('button', { name, exact: true })
  const dialog = page.getByRole('dialog')
  const save = async () => {
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  const capture = async (name: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (process.env.E2E_VISUAL === '1') await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true,
      style: 'nextjs-portal { visibility: hidden }' })
  }
  await tab('Счета').click()
  for (const [name, opening] of [['Тестовый кошелёк', '1000,01'], ['Тестовые накопления', '0']]) {
    await page.getByRole('button', { name: 'Создать счёт' }).click()
    await dialog.getByLabel('Название').fill(name)
    await dialog.getByLabel('Начальный баланс').fill(opening)
    await save()
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await tab('Операции').click()
  await page.getByRole('button', { name: 'Добавить операцию' }).click()
  await dialog.getByRole('combobox', { name: 'Счёт', exact: true }).selectOption({ label: 'Тестовый кошелёк · KGS' })
  await dialog.getByLabel('Категория').fill('Тестовая еда')
  await dialog.getByLabel('Сумма').fill('85,25')
  await dialog.getByLabel('Описание').fill('Тестовый обед')
  await save()
  await expect(page.getByText('Тестовый обед', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Перевести', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Со счёта', exact: true }).selectOption({ label: 'Тестовый кошелёк · KGS' })
  await dialog.getByRole('combobox', { name: 'На счёт', exact: true }).selectOption({ label: 'Тестовые накопления' })
  await dialog.getByLabel('Сумма').fill('100')
  await capture('finance-transfer')
  await save()
  await expect(page.locator('.finance-records').getByText('Перевод', { exact: true })).toBeVisible()
  await tab('Бюджеты').click()
  await page.getByRole('button', { name: 'Добавить бюджет' }).click()
  await dialog.getByLabel('Категория').fill('Тестовая еда')
  await dialog.getByLabel('Лимит').fill('100')
  await save()
  await expect(page.getByText(/Близко к лимиту.*14,75/)).toBeVisible()
  await capture('finance-budget')
  await tab('Цели').click()
  await page.getByRole('button', { name: 'Добавить цель' }).click()
  await dialog.getByLabel('Название').fill('Тестовая поездка')
  await dialog.getByRole('combobox', { name: 'Счёт накоплений', exact: true }).selectOption({ label: 'Тестовые накопления · KGS' })
  await dialog.getByLabel('Целевая сумма').fill('250')
  await save()
  await page.getByRole('button', { name: 'Пополнить' }).click()
  await dialog.getByLabel('Сумма').fill('50')
  await save()
  await expect(page.getByText(/Внесено 50,00.*250,00/)).toBeVisible()
  await capture('finance-goal')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Общий остаток' })).toBeVisible()
  await expect(page.getByText(/914,76/)).toBeVisible()
  await capture('finance-overview')
  await page.getByRole('button', { name: 'Тёмная тема' }).click()
  await expect(page.locator('.work-shell')).toHaveAttribute('data-theme', 'dark')
  await capture('finance-dark')
  await tab('Счета').click()
  const wallet = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Тестовый кошелёк' }) })
  await expect(wallet.getByText(/764,76/)).toBeVisible()
  await wallet.getByRole('button', { name: 'История' }).click()
  await page.getByRole('searchbox', { name: 'Поиск операций' }).fill('обед')
  await expect(page.locator('.finance-records li')).toHaveCount(1)
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await dialog.getByLabel('Сумма').fill('105,25')
  await save()
  await expect(page.getByText(/105,25/)).toBeVisible()
  await tab('Бюджеты').click()
  await expect(page.getByText(/Лимит превышен на 5,25/)).toBeVisible()
  await tab('Операции').click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('button', { name: 'Подтвердить удаление' }).click()
  await expect(page.getByText('Тестовый обед', { exact: true })).toBeHidden()
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'Мои задачи' })).toBeVisible()
  await capture('finance-neighbor-tasks')
})

test('settings, global commands, saved filters and exports work after direct navigation and reload', async ({ page }, info) => {
  test.setTimeout(120_000)
  const { email, token } = await register(page)
  const call = (path: string, data: object) => page.request.post(path, {
    headers: { origin: 'http://localhost:3200', authorization: 'Bearer ' + token }, data,
  })
  const project = await call('/api/projects', { name: 'Визуальный проект', description: '', color: 'green', icon: 'flag' })
  expect(project.status()).toBe(201)
  const { id: projectId } = await project.json()
  const task = await call('/api/tasks', {
    title: 'Встреча, «План»', description: 'Сверить чертежи', priority: 'urgent',
    tags: ['подготовка'], dueOn: '2020-05-01', projectId,
  })
  expect(task.status()).toBe(201)
  const { id } = await task.json()
  await expect((await call('/api/tasks', { title: 'Обычная заметка' })).status()).toBe(201)

  async function capture(name: string) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (process.env.E2E_VISUAL === '1') await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true,
      style: 'nextjs-portal { visibility: hidden }' })
  }

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
  const name = page.getByRole('textbox', { name: 'Имя', exact: true })
  await name.fill('Анна')
  await page.getByRole('button', { name: 'Сохранить имя' }).click()
  await expect(page.getByText('Имя сохранено.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('dark')
  await page.getByRole('combobox', { name: 'Напоминать о дедлайнах' }).selectOption('3')
  await page.getByRole('button', { name: 'Сохранить предпочтения' }).click()
  await expect(page.getByText('Предпочтения сохранены.')).toBeVisible()
  await expect(page.locator('.work-shell')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(name).toHaveValue('Анна')
  await expect(page.getByRole('combobox', { name: 'Напоминать о дедлайнах' })).toHaveValue('3')
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expect(page.getByText('Текущая сессия', { exact: true })).toBeVisible()
  await capture('settings-dark')
  await page.getByRole('combobox', { name: 'Тема', exact: true }).selectOption('light')
  await page.getByRole('button', { name: 'Сохранить предпочтения' }).click()
  await expect(page.locator('.work-shell')).toHaveAttribute('data-theme', 'light')
  await capture('settings-light')

  for (const format of ['CSV', 'JSON']) {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Скачать ' + format }).click()
    const download = await pending
    expect(download.suggestedFilename()).toBe('yasno-tasks.' + format.toLowerCase())
    const content = await readFile((await download.path())!, 'utf8')
    expect(content).toContain('Встреча, «План»')
    if (format === 'JSON') expect(JSON.parse(content)).toHaveLength(2)
    else expect(content.charCodeAt(0)).toBe(0xfeff)
  }

  // A separate request context does not replace the browser's refresh cookie.
  const second = await page.context().browser()!.newContext()
  try {
    const login = await second.request.post('http://localhost:3200/api/auth/login', {
      headers: { origin: 'http://localhost:3200' }, data: { email, password },
    })
    expect(login.status()).toBe(200)
    await page.reload()
    await expect(page.getByText('Другая сессия', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Завершить остальные сессии' }).click()
    await expect(page.getByRole('group', { name: 'Подтверждение завершения сессий' })).toBeVisible()
    await capture('settings-session-confirmation')
    await page.getByRole('button', { name: 'Подтвердить завершение' }).click()
    await expect(page.getByText('Остальные сессии завершены.')).toBeVisible()
    expect((await second.request.get('http://localhost:3200/api/tasks', {
      headers: { authorization: 'Bearer ' + (await login.json()).accessToken },
    })).status()).toBe(401)
  } finally { await second.close() }

  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Поиск и действия' })
  const search = palette.getByRole('searchbox', { name: 'Глобальный поиск' })
  await expect(search).toBeFocused()
  await search.fill('подготовка')
  await expect(palette.getByRole('button', { name: /#подготовка/ })).toBeVisible()
  await search.fill('чертежи')
  await expect(palette.getByRole('button', { name: /Встреча.*Сверить чертежи/ })).toBeVisible()
  await capture('palette')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/tasks/' + id)
  await expect(page.getByRole('dialog')).toBeVisible()
  await capture('task-details')
  await page.reload()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Встреча, «План»' })).toBeVisible()

  await page.getByRole('link', { name: 'К задачам' }).click()
  await page.getByLabel('Фильтр по приоритету').selectOption('urgent')
  await page.getByText('Сохранённые фильтры', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Название фильтра' }).fill('Срочные')
  await page.getByRole('button', { name: 'Сохранить текущий фильтр' }).click()
  await expect(page.getByText('Фильтр сохранён.')).toBeVisible()
  await page.reload()
  await page.getByText('Сохранённые фильтры', { exact: true }).click()
  await page.getByLabel('Сохранённый фильтр', { exact: true }).selectOption('Срочные')
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.getByLabel('Фильтр по приоритету')).toHaveValue('urgent')
  await expect(page.getByText('Обычная заметка', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Kanban', exact: true }).click()
  await capture('tasks-kanban-and-filters')

  await page.getByRole('button', { name: /Поиск Ctrl\+K/ }).click()
  await search.fill('визуальный')
  await palette.getByRole('button', { name: /Визуальный проект/ }).click()
  await expect(page).toHaveURL('/projects/' + projectId)
  await expect(page.getByRole('heading', { name: 'Визуальный проект' })).toBeVisible()
  await capture('project')
  await page.goto('/')
  await expect(page.locator('summary').filter({ hasText: 'Напоминания о дедлайнах' })).toBeVisible()
  await capture('overview')
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Проекты' })).toBeVisible()
  await capture('projects')
  await page.goto('/calendar')
  await expect(page.getByRole('heading', { name: 'Календарь' })).toBeVisible()
  await capture('calendar')
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible()
  await capture('analytics')

  await page.keyboard.press('Control+k')
  await page.keyboard.press('Enter')
  const newTask = page.getByRole('dialog', { name: 'Новая задача' })
  await newTask.getByRole('textbox', { name: 'Название', exact: true }).fill('Из палитры')
  await newTask.getByRole('button', { name: 'Сохранить задачу', exact: true }).click()
  await expect(newTask).toHaveCount(0)
  await page.keyboard.press('Control+k')
  await search.fill('Из палитры')
  await palette.getByRole('button', { name: 'Выполнить задачу «Из палитры»' }).click()
  await expect(palette.getByRole('button', { name: 'Возобновить задачу «Из палитры»' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/settings')
  await page.getByLabel('Текущий пароль', { exact: true }).fill(password)
  const newPassword = 'New-e2e-password-123!'
  const newPasswordField = page.getByLabel('Новый пароль', { exact: true })
  await expect(newPasswordField).toHaveAttribute('type', 'password')
  const visibility = page.getByRole('button', { name: 'Показать пароли' })
  await visibility.focus()
  await page.keyboard.press('Space')
  await expect(newPasswordField).toHaveAttribute('type', 'text')
  await expect(visibility).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Space')
  await newPasswordField.fill(newPassword)
  await page.getByLabel('Подтвердите новый пароль').fill('Wrong-e2e-confirmation')
  await page.getByRole('button', { name: 'Сменить пароль' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Новые пароли не совпадают.' })).toBeVisible()
  await capture('settings-password-error')
  await page.getByLabel('Подтвердите новый пароль').fill(newPassword)
  await page.getByRole('button', { name: 'Сменить пароль' }).click()
  await expect(page).toHaveURL('/login')
  await expect(page.getByText('Пароль изменён. Войдите с новым паролем.')).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
  await page.goto('/tasks')
  await page.getByText('Сохранённые фильтры', { exact: true }).click()
  await expect(page.getByRole('option', { name: 'Срочные' })).toBeAttached()
})

test('changes email using a code delivered by the local SMTP transport', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000)
  const sink = await listenForEmailCode()
  try {
    const { email } = await register(page)
    const firstAddress = newEmail()
    const replacement = newEmail()
    await page.goto('/settings')
    const section = page.getByRole('region', { name: 'Электронная почта' })
    const codeField = section.getByLabel('Код из письма')
        await expect(codeField).toHaveCount(0)
    await section.getByLabel('Новый email', { exact: true }).fill(firstAddress)
    await section.getByLabel('Пароль для смены email').fill('wrong-password')
    await section.getByRole('button', { name: 'Отправить код', exact: true }).click()
    await expect(section.getByRole('alert')).toHaveText('Неверный текущий пароль.')
    await expect(codeField).toHaveCount(0)
    await section.getByLabel('Пароль для смены email').fill(password)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/account/email', async route => { await pending; await route.continue() }, { times: 1 })
    await section.getByRole('button', { name: 'Отправить код', exact: true }).click()
    try {
      await expect(section.getByRole('button', { name: 'Подождите…' })).toBeDisabled()
      await expect(codeField).toHaveCount(0)
      if (process.env.E2E_VISUAL === '1') {
        await page.screenshot({ path: info.outputPath('settings-email-loading.png'), fullPage: true,
          style: 'nextjs-portal { visibility: hidden }' })
      }
    } finally { release() }
    await expect(codeField).toBeFocused()
    await expect(section.getByRole('status')).toContainText(firstAddress)
    const firstCode = sink.takeCode()
    expect(Boolean(firstCode), 'local SMTP received the first code').toBe(true)

    await section.getByRole('button', { name: 'Отправить повторно' }).click()
    await expect(section.getByLabel('Пароль для смены email')).toHaveValue('')
    await section.getByLabel('Пароль для смены email').fill(password)
    await section.getByRole('button', { name: 'Отправить новый код' }).click()
    await codeField.fill(firstCode!)
    await section.getByRole('button', { name: 'Подтвердить email' }).click()
    await expect(section.getByRole('alert')).toContainText('Код недействителен')
    await expect(codeField).toHaveAttribute('aria-invalid', 'true')
    await section.getByRole('button', { name: 'Изменить адрес' }).click()
    await expect(codeField).toHaveCount(0)
    await section.getByLabel('Новый email', { exact: true }).fill(replacement)
    await section.getByLabel('Пароль для смены email').fill(password)
    await section.getByRole('button', { name: 'Отправить код', exact: true }).click()
    await expect(section.getByRole('status')).toContainText(replacement)
    const code = sink.takeCode()
    expect(Boolean(code), 'local SMTP received the replacement address code').toBe(true)
    await codeField.fill('x'.repeat(43))
    await section.getByRole('button', { name: 'Подтвердить email' }).click()
    await expect(section.getByRole('alert')).toContainText('Код недействителен')
    await expect(codeField).toHaveCSS('border-top-color', 'rgb(164, 59, 56)')
    for (const width of isMobile ? [390] : [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 })
      const columns = await page.locator('.work-settings-column').evaluateAll(nodes => nodes.map(node => {
        const column = node.getBoundingClientRect()
        return { x: column.x, width: column.width }
      }))
      expect(columns).toHaveLength(2)
      expect(columns[0].width).toBeCloseTo(columns[1].width, 0)
      expect(columns[0].x === columns[1].x).toBe(width < 901)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.E2E_VISUAL === '1') {
        await page.screenshot({ path: info.outputPath(`settings-email-error-${width}.png`), fullPage: true,
          style: 'nextjs-portal { visibility: hidden }' })
      }
    }
    await expect(page.locator('.work-settings').getByText(email, { exact: true })).toBeVisible()
    await page.reload()
    await expect(section.getByRole('status')).toContainText(replacement)
    await codeField.fill(code!)
    await page.getByRole('button', { name: 'Подтвердить email' }).click()
    await expect(page.getByText('Email изменён.')).toBeVisible()
    await expect(codeField).toHaveCount(0)
    await expect(page.locator('.work-settings').getByText(replacement, { exact: true })).toBeVisible()
    await logout(page)
    await page.getByLabel('Email', { exact: true }).fill(replacement)
    await page.getByLabel('Пароль', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page.getByText(replacement, { exact: true })).toBeVisible()
  } finally { await sink.close() }
})

test('opens planning routes directly and persists a calendar deadline change', async ({ page, isMobile }) => {
  const { token, email } = await register(page)
  const month = await page.evaluate(() => {
    const now = new Date()
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
  })
  const first = month + '-12'
  const next = month + '-13'
  const origin = new URL(page.url()).origin
  const task = await page.request.post('/api/tasks', {
    headers: { Origin: origin, Authorization: `Bearer ${token}` },
    data: { title: 'Календарная задача', dueOn: first, status: 'done', priority: 'urgent' },
  })
  expect(task.status()).toBe(201)
  expect((await page.goto('/calendar'))?.status()).toBe(200)
  const cell = (day: string) => page.locator(`.calendar-day[data-day="${day}"]`)
  await expect(cell(first).getByRole('button').first()).toHaveAccessibleName(/задач: 1/)
  if (isMobile) {
    await cell(first).getByRole('button').first().click()
    await page.getByRole('region', { name: 'Задачи выбранного дня' }).getByRole('button', { name: /Календарная задача/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Дедлайн').fill(next)
    await dialog.getByRole('button', { name: 'Сохранить задачу' }).click()
    await expect(dialog).toBeHidden()
  } else {
    await cell(first).getByRole('button', { name: /Календарная задача/ }).dragTo(cell(next))
  }
  await expect(cell(next).getByRole('button').first()).toHaveAccessibleName(/задач: 1/)
  await page.getByRole('button', { name: 'Неделя', exact: true }).click()
  await expect(page.locator('.calendar-day')).toHaveCount(7)
  await page.reload()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expect(cell(next).getByRole('button').first()).toHaveAccessibleName(/задач: 1/)
  expect((await page.goto('/analytics'))?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible()
  await expect(page.locator('.analytics-stats')).toContainText('100%')
  await page.getByRole('button', { name: '7 дней' }).click()
  await expect(page.getByRole('heading', { name: 'Динамика за 7 дней' })).toBeVisible()
  await page.getByRole('button', { name: 'По неделям' }).click()
  await expect(page.getByRole('button', { name: 'По неделям' })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expect(page.locator('.analytics-stats')).toContainText('100%')
})

test('opens tasks from the menu, direct URL and reload with the same session', async ({ page, context }) => {
  const { email } = await register(page)
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('heading', { name: 'Мои задачи' })).toBeVisible()

  const direct = await context.newPage()
  try {
    const tasks = page.url()
    expect((await direct.goto(tasks, { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
    await expect(direct.getByText(email, { exact: true })).toBeVisible()
    expect((await direct.reload({ waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
    await expect(direct).toHaveURL(/\/tasks$/)
    await expect(direct.getByText(email, { exact: true })).toBeVisible()
    expect((await direct.goto(new URL('/projects', tasks).href, { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
    await expect(direct.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible()
    await expect(direct.getByText(email, { exact: true })).toBeVisible()
  } finally {
    await direct.close()
  }
})

test('plans a task and persists status changes from Kanban', async ({ page, isMobile }) => {
  await register(page)
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click()
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача' })
  await dialog.getByLabel('Название', { exact: true }).fill('Подготовить релиз')
  await dialog.getByLabel('Описание').fill('Проверить список изменений')
  await dialog.getByLabel('Приоритет').selectOption('urgent')
  await dialog.getByLabel('Дедлайн').fill('2030-06-01')
  await dialog.getByRole('button', { name: 'Сохранить задачу' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Kanban', exact: true }).click()
  const board = page.locator('.work-board')
  const card = board.locator('article').filter({ hasText: 'Подготовить релиз' })
  if (!isMobile) await card.dragTo(board.locator('section[data-status="in-progress"]'))
  else await card.getByLabel('Статус задачи: Подготовить релиз').selectOption('in-progress')
  await expect(card.getByLabel('Статус задачи: Подготовить релиз')).toHaveValue('in-progress')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Kanban', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByLabel('Статус задачи: Подготовить релиз')).toHaveValue('in-progress')

  await page.getByRole('link', { name: 'Проекты', exact: true }).click()
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click()
  await page.getByLabel('Название проекта').fill('Проверка режима')
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click()
  await page.getByRole('link', { name: /Проверка режима/ }).click()
  await expect(page.getByRole('button', { name: 'Kanban', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Список', exact: true }).click()
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('button', { name: 'Список', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Список', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('creates a project, completes tasks in bulk and opens their history', async ({ page }) => {
  await register(page)
  await page.getByRole('link', { name: 'Проекты', exact: true }).click()
  await page.getByRole('button', { name: 'Новый проект' }).click()
  await page.getByLabel('Название проекта').fill('Подготовка запуска')
  await page.getByRole('button', { name: 'Сохранить проект' }).click()
  await page.getByRole('link', { name: /Подготовка запуска/ }).click()
  await expect(page.getByRole('heading', { name: 'Подготовка запуска' })).toBeVisible()
  await page.getByRole('button', { name: 'Новая задача' }).click()
  const dialog = page.getByRole('dialog', { name: 'Новая задача' })
  await dialog.getByLabel('Название', { exact: true }).fill('Задача проекта')
  await dialog.getByLabel('Категория').fill('Релиз')
  await dialog.getByLabel('Теги через запятую').fill('qa')
  await dialog.getByRole('button', { name: 'Добавить подзадачу', exact: true }).click()
  await dialog.getByLabel('Подзадача 1', { exact: true }).fill('Проверить карточку')
  await dialog.getByLabel('Подзадача 1 выполнена').check()
  await dialog.getByRole('button', { name: 'Сохранить задачу' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Выбрать задачи' }).click()
  await page.getByLabel('Выбрать задачу: Задача проекта').check()
  await page.getByLabel('Действие для выбранных задач').selectOption('done')
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.getByText('1 из 1 выполнено')).toBeVisible()
  await page.getByRole('button', { name: 'Свойства задачи: Задача проекта' }).click()
  await page.getByText('История задачи', { exact: true }).click()
  await expect(page.getByText(/Изменение: Статус/)).toBeVisible()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.getByRole('button', { name: 'Архивировать', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Восстановить проект' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Задача проекта', exact: true })).toBeVisible()
})

async function createTask(page: Page, title: string) {
  await expect(page).toHaveURL(/\/tasks$/)
  const manager = page.getByRole('region', { name: 'Менеджер задач' })
  const input = manager.getByLabel('Название новой задачи')
  await input.fill(title)
  await manager.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(manager.getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(input).toBeEmpty()
}

async function expectResponsive(page: Page) {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  )), 'no horizontal overflow').toBe(true)
}

test('registration, logout, login and auth restoration after reload', async ({ page, context }) => {
  const { email } = await register(page)
  const refresh = (await context.cookies()).find((cookie) => cookie.name === 'refreshToken')
  expect(refresh?.httpOnly).toBe(true)
  expect(refresh?.sameSite).toBe('Strict')
  expect(refresh?.path).toBe('/api/auth')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expectResponsive(page)
  await logout(page)
  expect((await context.cookies()).some((cookie) => cookie.name === 'refreshToken')).toBe(false)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(email, { exact: true })).toBeVisible()
})

test('task CRUD, filters and PostgreSQL persistence after reload', async ({ page }) => {
  await register(page)
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click()
  await createTask(page, 'Alpha')
  await createTask(page, 'Beta')
  await page.getByRole('button', { name: 'Alpha', exact: true }).dblclick()
  const editor = page.getByLabel('Редактировать название задачи')
  await expect(editor).toBeFocused()
  await editor.fill('Alpha renamed')
  await editor.press('Enter')
  await expect(page.getByRole('button', { name: 'Alpha renamed', exact: true })).toBeVisible()
  const checkbox = page.getByLabel('Отметить задачу: Alpha renamed', { exact: true })
  await expect(checkbox).toBeEnabled()
  await checkbox.check()
  await expect(checkbox).toBeEnabled()
  await expect(checkbox).toBeChecked()
  await page.getByRole('button', { name: 'Выполненные', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Alpha renamed', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Активные', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Alpha renamed', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Все', exact: true }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByLabel('Отметить задачу: Alpha renamed', { exact: true })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toBeVisible()
  await expectResponsive(page)
  for (const title of ['Alpha renamed', 'Beta']) {
    await page.getByLabel(`Удалить задачу: ${title}`, { exact: true }).click()
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0)
  }
  await expect(page.getByRole('heading', { name: 'Начните с маленького шага' })).toBeVisible()
})

test('field validation and identical bad-credential errors', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  const emailInput = page.getByLabel('Email', { exact: true })
  const passwordInput = page.getByLabel('Пароль', { exact: true })
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(emailInput).toHaveAccessibleDescription('Введите email')
  await expect(passwordInput).toHaveAccessibleDescription('Введите пароль')
  await emailInput.fill('bad-email')
  await passwordInput.fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(emailInput).toHaveAccessibleDescription('Некорректный email')
  const alert = page.getByRole('alert').filter({ hasText: 'Некорректный email' })
  await expect(alert).toBeVisible()
  await emailInput.focus()
  const inputBox = await emailInput.boundingBox()
  const errorBox = await alert.boundingBox()
  expect(errorBox!.y - (inputBox!.y + inputBox!.height)).toBeGreaterThanOrEqual(6)
  await expectResponsive(page)

  const { email } = await register(page)
  await logout(page)
  for (const values of [
    { email, password: 'Incorrect-password-123' },
    { email: newEmail(), password },
  ]) {
    await emailInput.fill(values.email)
    await passwordInput.fill(values.password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(passwordInput).toHaveAccessibleDescription('Неверный email или пароль')
    await expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    await expect(emailInput).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('form').getByRole('alert')).toHaveText('Неверный email или пароль')
  }
})

test('account switch isolates task cache and backend ownership', async ({ page }) => {
  await register(page)
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click()
  const createdPromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/tasks') && response.request().method() === 'POST'
  ))
  await createTask(page, 'First account secret')
  const created = await (await createdPromise).json() as { id: string }
  await logout(page)
  const second = await register(page)
  await page.getByRole('link', { name: 'Мои задачи', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Начните с маленького шага' })).toBeVisible()
  await expect(page.getByText('First account secret', { exact: true })).toHaveCount(0)
  const response = await page.request.get(`/api/tasks/${created.id}`, {
    headers: { Authorization: `Bearer ${second.token}` },
  })
  expect(response.status()).toBe(404)
  await createTask(page, 'Second account task')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Second account task', exact: true })).toBeVisible()
  await expect(page.getByText('First account secret', { exact: true })).toHaveCount(0)
  await expectResponsive(page)
})

base('my day creates and completes tasks, recovers from a load error and opens workspace sections', async ({ page }, info) => {
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  const capture = async (name: string) => {
    await expectResponsive(page)
    if (process.env.E2E_VISUAL === '1') await page.screenshot({
      path: info.outputPath(name + '.png'), style: 'nextjs-portal { visibility: hidden }',
    })
  }
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/tasks', async route => {
    await gate
    await route.fulfill({ status: 500, json: {} })
  }, { times: 1 })
  const { token } = await register(page)
  await expect(page).toHaveTitle('ЯСНО. — Мой день')
  const nav = page.getByRole('navigation', { name: 'Рабочее пространство' })
  await expect(nav.getByRole('link')).toHaveText([
    'Обзор', 'Мои задачи', 'Проекты', 'Календарь', 'Аналитика', 'Финансы', 'Настройки',
  ])
  await expect(page.getByRole('region', { name: 'Менеджер задач' })).toHaveCount(0)
  await page.addStyleTag({ content: 'nextjs-portal { visibility: hidden !important; pointer-events: none !important }' })
  const today = page.getByRole('region', { name: 'Сегодня' })
  await expect(today.getByRole('status')).toHaveText('Загружаем задачи…')
  await capture('my-day-loading')
  release()
  await expect(today.getByRole('alert')).toContainText('Не удалось загрузить задачи')
  await capture('my-day-error')
  await today.getByRole('button', { name: 'Повторить' }).click()
  await expect(today.getByText('На сегодня задач пока нет.')).toBeVisible()
  await expect(page.getByText('Активных проектов пока нет.')).toBeVisible()
  await expect(page.getByText(/Добавьте счёт/)).toBeVisible()
  await capture('my-day-empty')

  await today.getByLabel('Название новой задачи').fill('Записать планы')
  await today.getByRole('button', { name: 'Добавить' }).click()
  const checkbox = today.getByRole('checkbox', { name: 'Выполнена задача: Записать планы' })
  await expect(checkbox).toBeEnabled()
  await checkbox.check()
  await expect(today.getByText('Выполнено 1 из 1')).toBeVisible()

  const day = await page.locator('.my-day-heading time').getAttribute('datetime')
  const upcoming = page.getByRole('region', { name: 'Ближайшие дела' })
  const headers = { Origin: new URL(page.url()).origin, Authorization: `Bearer ${token}` }
  const project = await page.request.post('/api/projects', {
    headers, data: { name: 'Домашние планы', description: '', color: 'green', icon: 'flag' },
  })
  expect(project.status()).toBe(201)
  const { id: projectId } = await project.json()
  for (const [offset, title] of [[-1, 'Просроченная задача'], [7, 'Через неделю'], [8, 'За пределами недели']] as const) {
    const date = new Date(day + 'T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + offset)
    const response = await page.request.post('/api/tasks', {
      headers, data: { title, projectId, dueOn: date.toISOString().slice(0, 10) },
    })
    expect(response.status()).toBe(201)
  }
  await page.route('**/api/finance', route => route.fulfill({ json: {
    accounts: [
      { id: 'a', currency: 'KGS', opening: '10001', archived: false },
      { id: 'b', currency: 'USD', opening: '999', archived: false },
    ],
    entries: [], budgets: [], goals: [],
  } }), { times: 1 })
  await page.reload()
  await expect(checkbox).toBeChecked()
  await expect(page).toHaveTitle('ЯСНО. — Мой день')
  await expect(upcoming.getByRole('heading', { name: 'Просрочено' })).toBeVisible()
  await upcoming.getByRole('button', { name: 'Открыть задачу: Через неделю' }).click()
  const editor = page.getByRole('dialog', { name: 'Свойства задачи' })
  await expect(editor).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(upcoming.getByText('За пределами недели')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Мои проекты' }).getByText('0 из 3')).toBeVisible()
  const finance = page.getByRole('region', { name: 'Финансы' })
  await expect(finance.getByText(/100,01\s+KGS/)).toBeVisible()
  await expect(finance.getByText(/9,99\s+USD/)).toBeVisible()
  await capture('my-day-populated')
  if (process.env.E2E_VISUAL === '1') await finance.screenshot({
    path: info.outputPath('my-day-balances.png'), style: 'nextjs-portal { visibility: hidden }',
  })
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.evaluate(() => {
    localStorage.setItem('yasno-work-theme', 'dark')
    window.dispatchEvent(new Event('storage'))
  })
  await expect(page.locator('.work-shell')).toHaveAttribute('data-theme', 'dark')
  await capture('my-day-dark')

  const overview = page.getByRole('region', { name: 'Мой день' })
  for (const [link, path, heading] of [
    ['Все задачи', '/tasks', 'Мои задачи'],
    ['Все проекты', '/projects', 'Проекты'],
    ['Календарь', '/calendar', 'Календарь'],
    ['К финансам', '/finance', 'Финансы'],
  ]) {
    await overview.getByRole('link', { name: link, exact: true }).click()
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(page).toHaveTitle(`ЯСНО. — ${heading}`)
    await capture('neighbor-' + path.slice(1))
    await page.goto('/')
  }
  expect(browserErrors).toEqual([])
})
