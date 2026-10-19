import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() !== 'error' && !/hydration|hydrating/i.test(message.text())) return
      const text = message.text()
      // Expected anonymous/bootstrap and bad-credential HTTP responses are not JS errors.
      if (/^Failed to load resource:.*\b401\b/.test(text)) return
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
  await expect(page.getByRole('heading', { name: 'Мои задачи' })).toBeVisible()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  return { email, token: data.accessToken }
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
}

async function createTask(page: Page, title: string) {
  await page.getByLabel('Название новой задачи').fill(title)
  await page.getByRole('button', { name: /Добавить/ }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(page.getByLabel('Название новой задачи')).toBeEmpty()
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
  const createdPromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/tasks') && response.request().method() === 'POST'
  ))
  await createTask(page, 'First account secret')
  const created = await (await createdPromise).json() as { id: string }
  await logout(page)
  const second = await register(page)
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
