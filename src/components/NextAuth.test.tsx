// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Providers from '../app/providers'
import { AuthGuard } from './AuthGuard'
import { AuthPage } from './AuthPage'
import { useAppSelector } from '../store'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const NativeRequest = globalThis.Request
const session = { accessToken: 'access', user: { id: '1', email: 'one@example.com' } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

beforeEach(() => {
  router.replace.mockReset()
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, 'http://localhost:3000') : input, init)
    }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Identity() {
  const email = useAppSelector((state) => state.auth.session?.user.email)
  return <p>{email}</p>
}

it('restores once in StrictMode and keeps credentials in the request', async () => {
  let complete: ((response: Response) => void) | undefined
  const fetch = vi.fn((request: Request) => {
    expect(request.credentials).toBe('include')
    expect(request.url).toBe('http://localhost:3000/api/auth/refresh')
    return new Promise<Response>((resolve) => { complete = resolve })
  })
  vi.stubGlobal('fetch', fetch)
  render(<StrictMode><Providers><AuthGuard><Identity /></AuthGuard></Providers></StrictMode>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(screen.queryByText(session.user.email)).not.toBeInTheDocument()
  complete!(json(session))
  expect(await screen.findByText(session.user.email)).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(router.replace).not.toHaveBeenCalled()
})

it('redirects an anonymous visitor only after a confirmed refresh 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)))
  render(<Providers><AuthGuard><p>Private content</p></AuthGuard></Providers>)
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  expect(screen.queryByText('Private content')).not.toBeInTheDocument()
})

it.each(['server', 'network'])('offers retry after a %s error without redirecting', async (failure) => {
  const fetch = vi.fn()
    .mockImplementationOnce(async () => {
      if (failure === 'network') throw new TypeError('Network unavailable')
      return json({}, 500)
    })
    .mockResolvedValueOnce(json(session))
  vi.stubGlobal('fetch', fetch)
  render(<Providers><AuthGuard><Identity /></AuthGuard></Providers>)
  const retry = await screen.findByRole('button', { name: 'Повторить запрос' })
  expect(router.replace).not.toHaveBeenCalled()
  fireEvent.click(retry)
  expect(await screen.findByText(session.user.email)).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('isolates session state between provider trees', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(json(session))
    .mockResolvedValueOnce(json({ ...session, user: { id: '2', email: 'two@example.com' } })))
  render(<><Providers><Identity /></Providers><Providers><Identity /></Providers></>)
  expect(await screen.findByText('one@example.com')).toBeInTheDocument()
  expect(await screen.findByText('two@example.com')).toBeInTheDocument()
})

it('uses the existing login form and redirects through Next navigation', async () => {
  const fetch = vi.fn(async (request: Request) => (
    request.url.endsWith('/auth/refresh') ? json({}, 401) : json(session)
  ))
  vi.stubGlobal('fetch', fetch)
  render(<Providers><AuthPage /></Providers>)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'one@example.com' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'test-password-123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
  const request = fetch.mock.calls.find(([request]) => request.url.endsWith('/auth/login'))?.[0]
  expect(request).toBeDefined()
  expect(await request!.json()).toEqual({ email: 'one@example.com', password: 'test-password-123' })
})

it('submits registration through the existing API endpoint', async () => {
  const fetch = vi.fn(async (request: Request) => (
    request.url.endsWith('/auth/refresh') ? json({}, 401) : json(session)
  ))
  vi.stubGlobal('fetch', fetch)
  render(<Providers><AuthPage register /></Providers>)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'one@example.com' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'test-password-123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
  expect(fetch.mock.calls.some(([request]) => request.url.endsWith('/auth/register'))).toBe(true)
})

it.each([
  [401, 'Неверный email или пароль'],
  [400, 'Неверный email или пароль'],
  [500, 'Сервис временно недоступен. Попробуйте позже'],
  ['network', 'Не удалось соединиться с сервером. Проверьте подключение к интернету и повторите попытку.'],
])('shows an accessible login error for %s without starting refresh', async (status, message) => {
  const fetch = vi.fn(async (request: Request) => {
    if (request.url.endsWith('/auth/refresh')) return json({}, 401)
    if (status === 'network') throw new TypeError('Offline')
    return json({ message: 'Do not expose server details' }, status as number)
  })
  vi.stubGlobal('fetch', fetch)
  render(<Providers><AuthPage /></Providers>)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'unknown@example.com' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toBeVisible()
  expect(alert).toHaveTextContent(message)
  const email = screen.getByLabelText('Email')
  const password = screen.getByLabelText('\u041f\u0430\u0440\u043e\u043b\u044c')
  if (status === 401 || status === 400) {
    expect(password).toHaveAccessibleDescription(message)
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password.closest('label')!.parentElement).toContainElement(alert)
    expect(email).not.toHaveAttribute('aria-invalid')
  } else {
    expect(password).not.toHaveAttribute('aria-invalid')
    expect(email).not.toHaveAttribute('aria-invalid')
    expect(alert.parentElement).toBe(password.closest('form'))
  }
  expect(router.replace).not.toHaveBeenCalled()
  expect(fetch.mock.calls.filter(([request]) => request.url.endsWith('/auth/refresh'))).toHaveLength(1)
})

it('validates malformed email visibly without sending login', async () => {
  const fetch = vi.fn(async () => json({}, 401))
  vi.stubGlobal('fetch', fetch)
  render(<Providers><AuthPage /></Providers>)
  const input = await screen.findByLabelText('Email')
  fireEvent.change(input, { target: { value: 'not-an-email' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Некорректный email')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAccessibleDescription('Некорректный email')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('clears the previous error and blocks duplicate submits while pending', async () => {
  let complete: ((response: Response) => void) | undefined
  let logins = 0
  const fetch = vi.fn(async (request: Request) => {
    if (request.url.endsWith('/auth/refresh')) return json({}, 401)
    logins += 1
    if (logins === 1) return json({}, 401)
    return new Promise<Response>((resolve) => { complete = resolve })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Providers><AuthPage /></Providers>)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'one@example.com' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
  await screen.findByRole('alert')
  const button = screen.getByRole('button', { name: 'Войти' })
  const form = button.closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Подождите…' })).toBeDisabled()
  await waitFor(() => expect(complete).toBeDefined())
  expect(logins).toBe(2)
  complete!(json({}, 500))
  expect(await screen.findByRole('alert')).toHaveTextContent('Сервис временно недоступен. Попробуйте позже')
  expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled()
})

it('does not disclose whether an email already exists during registration', async () => {
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => (
    request.url.endsWith('/auth/refresh')
      ? json({}, 401)
      : json({ message: 'Email уже зарегистрирован' }, 409)
  )))
  render(<Providers><AuthPage register /></Providers>)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'one@example.com' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Не удалось создать аккаунт. Проверьте данные или попробуйте войти.')
  expect(alert).not.toHaveTextContent('уже зарегистрирован')
})


it.each([false, true])('shows both required errors under their fields (register=%s)', async (register) => {
  const fetch = vi.fn(async () => json({}, 401))
  vi.stubGlobal('fetch', fetch)
  render(<Providers><AuthPage register={register} /></Providers>)
  const email = await screen.findByLabelText('Email')
  const password = screen.getByLabelText('Пароль')
  fireEvent.submit(email.closest('form')!)
  expect(email).toHaveAccessibleDescription('Введите email')
  expect(password).toHaveAccessibleDescription('Введите пароль')
  expect(email).toHaveAttribute('aria-invalid', 'true')
  expect(password).toHaveAttribute('aria-invalid', 'true')
  const emailAlert = screen.getByText('Введите email')
  const passwordAlert = screen.getByText('Введите пароль')
  expect(emailAlert).toHaveAttribute('role', 'alert')
  expect(passwordAlert).toHaveAttribute('role', 'alert')
  expect(email.closest('label')!.parentElement).toContainElement(emailAlert)
  expect(password.closest('label')!.parentElement).toContainElement(passwordAlert)

  fireEvent.change(email, { target: { value: 'bad-email' } })
  expect(email).toHaveAccessibleDescription('Некорректный email')
  fireEvent.change(email, { target: { value: 'valid@example.com' } })
  expect(email).not.toHaveAttribute('aria-invalid')
  expect(email).not.toHaveAttribute('aria-describedby')
  expect(password).toHaveAccessibleDescription('Введите пароль')
  fireEvent.change(password, { target: { value: 'password123' } })
  expect(password).not.toHaveAttribute('aria-invalid')
  expect(password).not.toHaveAttribute('aria-describedby')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['email', 'password'])('clears a credential-pair error when %s changes', async (field) => {
  vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)))
  render(<Providers><AuthPage /></Providers>)
  const email = await screen.findByLabelText('Email')
  const password = screen.getByLabelText('Пароль')
  fireEvent.change(email, { target: { value: 'one@example.com' } })
  fireEvent.change(password, { target: { value: 'wrong' } })
  fireEvent.submit(email.closest('form')!)
  expect(await screen.findByRole('alert')).toHaveTextContent('Неверный email или пароль')
  fireEvent.change(field === 'email' ? email : password, {
    target: { value: field === 'email' ? 'two@example.com' : 'different' },
  })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(password).not.toHaveAttribute('aria-invalid')
  expect(password).not.toHaveAttribute('aria-describedby')
})
