// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import '@testing-library/jest-dom/vitest'
import { Provider } from 'react-redux'
import Providers from '../app/providers'
import HomePage from '../app/page'
import { AuthGuard } from './AuthGuard'
import TaskManager from './TaskManager'
import { createStore } from '../store'
import { setSession } from '../store/auth'
import { taskApi } from '../store/api'
import type { Task } from '../types/task'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const NativeRequest = globalThis.Request
const session = { accessToken: 'one', user: { id: '1', email: 'one@example.com' } }
const secondSession = { accessToken: 'two', user: { id: '2', email: 'two@example.com' } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const stores: ReturnType<typeof createStore>[] = []

beforeEach(() => {
  router.replace.mockReset()
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, 'http://localhost:3000') : input, init)
    }
  })
})
afterEach(() => {
  cleanup()
  for (const store of stores) store.dispatch(taskApi.util.resetApiState())
  stores.length = 0
  vi.unstubAllGlobals()
})

function renderManager() {
  const store = createStore()
  stores.push(store)
  store.dispatch(setSession(session))
  const view = render(<Provider store={store}><AuthGuard><TaskManager /></AuthGuard></Provider>)
  return { store, ...view }
}

it('reuses the UI for create, edit, complete, filter and delete with tag refetches', async () => {
  let tasks: Task[] = [
    { id: '1', title: 'Active task', completed: false },
    { id: '2', title: 'Done task', completed: true },
  ]
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    expect(request.headers.get('authorization')).toBe('Bearer one')
    const id = request.url.split('/').at(-1)
    if (request.method === 'GET') { reads += 1; return json(tasks) }
    if (request.method === 'POST') {
      const body = await request.json()
      const task = { id: '3', title: body.title, completed: false }
      tasks = [...tasks, task]
      return json(task, 201)
    }
    if (request.method === 'PATCH') {
      const body = await request.json()
      tasks = tasks.map((task) => task.id === id ? { ...task, ...body } : task)
      return json(tasks.find((task) => task.id === id))
    }
    tasks = tasks.filter((task) => task.id !== id)
    return new Response(null, { status: 204 })
  }))
  renderManager()
  await screen.findByText('Active task')
  fireEvent.click(screen.getByRole('button', { name: 'Выполненные' }))
  expect(screen.queryByText('Active task')).not.toBeInTheDocument()
  expect(screen.getByText('Done task')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Активные' }))
  expect(screen.getByText('Active task')).toBeInTheDocument()
  expect(screen.queryByText('Done task')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Все' }))

  fireEvent.change(screen.getByLabelText('Название новой задачи'), { target: { value: ' New task ' } })
  fireEvent.click(screen.getByRole('button', { name: /Добавить/ }))
  await screen.findByText('New task')
  fireEvent.doubleClick(screen.getByText('New task'))
  const editor = screen.getByLabelText('Редактировать название задачи')
  expect(editor).toHaveFocus()
  fireEvent.change(editor, { target: { value: 'Renamed task' } })
  fireEvent.keyDown(editor, { key: 'Enter' })
  await screen.findByText('Renamed task')
  await waitFor(() => expect(screen.getByLabelText('Отметить задачу: Renamed task')).toBeEnabled())
  fireEvent.click(screen.getByLabelText('Отметить задачу: Renamed task'))
  await waitFor(() => expect(screen.getByLabelText('Отметить задачу: Renamed task')).toBeChecked())
  await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67'))
  await waitFor(() => expect(screen.getByLabelText('Удалить задачу: Renamed task')).toBeEnabled())
  fireEvent.click(screen.getByLabelText('Удалить задачу: Renamed task'))
  await waitFor(() => expect(screen.queryByText('Renamed task')).not.toBeInTheDocument())
  expect(reads).toBeGreaterThanOrEqual(4)
})

it('shows load failure, retries and displays the empty state', async () => {
  let complete: ((response: Response) => void) | undefined
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
    .mockResolvedValueOnce(json([]))
  vi.stubGlobal('fetch', fetch)
  renderManager()
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем задачи')
  await waitFor(() => expect(complete).toBeDefined())
  complete!(json({}, 500))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить задачи')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByText('Начните с маленького шага')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('rolls back an optimistic completion when PATCH fails', async () => {
  let complete: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn((request: Request) => (
    request.method === 'GET'
      ? Promise.resolve(json([{ id: '1', title: 'Plan', completed: false }]))
      : new Promise<Response>((resolve) => { complete = resolve })
  )))
  renderManager()
  const checkbox = await screen.findByLabelText('Отметить задачу: Plan')
  fireEvent.click(checkbox)
  expect(checkbox).toBeChecked()
  await waitFor(() => expect(complete).toBeDefined())
  complete!(json({}, 500))
  await waitFor(() => expect(checkbox).not.toBeChecked())
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить изменение')
})

it('waits for bootstrap and fetches tasks again after a fresh page mount', async () => {
  let complete: ((response: Response) => void) | undefined
  let restored = false
  let reads = 0
  let refreshes = 0
  vi.stubGlobal('fetch', vi.fn((request: Request) => {
    if (request.url.endsWith('/auth/refresh')) {
      refreshes += 1
      if (!restored) return new Promise<Response>((resolve) => { complete = resolve })
      return Promise.resolve(json(session))
    }
    expect(restored).toBe(true)
    reads += 1
    return Promise.resolve(json([{ id: '1', title: 'Persisted task', completed: false }]))
  }))
  const first = render(<Providers><HomePage /></Providers>)
  await waitFor(() => expect(complete).toBeDefined())
  expect(reads).toBe(0)
  restored = true
  complete!(json(session))
  await screen.findByText('Persisted task')
  first.unmount()
  render(<Providers><HomePage /></Providers>)
  await screen.findByText('Persisted task')
  expect(reads).toBe(2)
  expect(refreshes).toBe(2)
})

it('does not query or render the task UI for an anonymous visitor', async () => {
  const fetch = vi.fn(async () => json({}, 401))
  vi.stubGlobal('fetch', fetch)
  render(<Providers><HomePage /></Providers>)
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  expect(screen.queryByLabelText('Название новой задачи')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('clears private cache on logout and never displays it for the next account', async () => {
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    if (request.url.endsWith('/auth/logout')) return new Response(null, { status: 204 })
    const own = request.headers.get('authorization') === 'Bearer one'
    return json([{ id: own ? '1' : '2', title: own ? 'Private one' : 'Private two', completed: false }])
  }))
  const { store } = renderManager()
  await screen.findByText('Private one')
  fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  expect(store.getState().auth.session).toBeNull()
  expect(taskApi.endpoints.tasks.select()(store.getState()).data).toBeUndefined()
  expect(screen.queryByText('Private one')).not.toBeInTheDocument()
  act(() => { store.dispatch(setSession(secondSession)) })
  await screen.findByText('Private two')
  expect(screen.queryByText('Private one')).not.toBeInTheDocument()
})

it('resets data and local filters on direct account changes', async () => {
  let complete: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn((request: Request) => (
    request.headers.get('authorization') === 'Bearer one'
      ? Promise.resolve(json([{ id: '1', title: 'Private one', completed: true }]))
      : new Promise<Response>((resolve) => { complete = resolve })
  )))
  const { store } = renderManager()
  await screen.findByText('Private one')
  fireEvent.click(screen.getByRole('button', { name: 'Выполненные' }))
  act(() => { store.dispatch(setSession(secondSession)) })
  expect(screen.queryByText('Private one')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(complete).toBeDefined())
  complete!(json([{ id: '2', title: 'Private two', completed: false }]))
  await screen.findByText('Private two')
})

it('server-renders only the deterministic bootstrap shell without fetching', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const html = renderToString(<Providers><HomePage /></Providers>)
  expect(html).toContain('Восстанавливаем сессию')
  expect(html).not.toContain('Название новой задачи')
  expect(fetch).not.toHaveBeenCalled()
})

it('hydrates the bootstrap shell before loading private tasks without mismatches', async () => {
  const fetch = vi.fn(async (request: Request) => (
    request.url.endsWith('/auth/refresh')
      ? json(session)
      : json([{ id: '1', title: 'Hydrated task', completed: false }])
  ))
  vi.stubGlobal('fetch', fetch)
  const container = document.createElement('div')
  container.innerHTML = renderToString(<Providers><HomePage /></Providers>)
  expect(fetch).not.toHaveBeenCalled()
  document.body.appendChild(container)
  const onRecoverableError = vi.fn()
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    await act(async () => {
      root = hydrateRoot(container, <Providers><HomePage /></Providers>, { onRecoverableError })
    })
    await screen.findByText('Hydrated task')
    expect(onRecoverableError).not.toHaveBeenCalled()
  } finally {
    act(() => root?.unmount())
    container.remove()
  }
})
