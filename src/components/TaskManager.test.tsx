// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import '@testing-library/jest-dom/vitest'
import { Provider } from 'react-redux'
import Providers from '../app/providers'
import HomePage from '../app/page'
import TasksPage from '../app/tasks/page'
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
const preferenceKey = 'yasno-task-view:1'
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
  localStorage.removeItem(preferenceKey)
  localStorage.removeItem('yasno-task-view:2')
  for (const store of stores) store.dispatch(taskApi.util.resetApiState())
  stores.length = 0
  vi.unstubAllGlobals()
})

function stubFetch(fetch: (request: Request) => Promise<Response>) {
  vi.stubGlobal('fetch', (request: Request) => {
    if (request.url.endsWith('/finance')) return Promise.resolve(json({ accounts: [], entries: [], budgets: [], goals: [] }))
    if (request.url.endsWith('/projects')) return Promise.resolve(json([]))
    return fetch(request)
  })
}
function renderManager(tasksOnly = true) {
  const store = createStore()
  stores.push(store)
  store.dispatch(setSession(session))
  const view = render(<Provider store={store}><AuthGuard><TaskManager tasksOnly={tasksOnly} /></AuthGuard></Provider>)
  return { store, ...view }
}

it('reuses the UI for create, edit, complete, filter and delete with tag refetches', async () => {
  let tasks: Task[] = [
    { id: '1', title: 'Active task', completed: false },
    { id: '2', title: 'Done task', completed: true },
  ]
  let reads = 0
  stubFetch(vi.fn(async (request: Request) => {
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
  const fetch = vi.fn<(request: Request) => Promise<Response>>()
    .mockImplementation((request: Request) => {
      if (!request.url.endsWith('/tasks') || complete) return Promise.resolve(json([]))
      return new Promise<Response>((resolve) => { complete = resolve })
    })
  stubFetch(fetch)
  renderManager()
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем задачи')
  await waitFor(() => expect(complete).toBeDefined())
  complete!(json({}, 500))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить задачи')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByText('Начните с маленького шага')).toBeInTheDocument()
  expect(fetch.mock.calls.filter(([request]) => request.url.endsWith('/tasks'))).toHaveLength(2)
})

it('rolls back an optimistic completion when PATCH fails', async () => {
  let complete: ((response: Response) => void) | undefined
  stubFetch(vi.fn((request: Request) => (
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
  stubFetch(vi.fn((request: Request) => {
    if (request.url.endsWith('/auth/refresh')) {
      refreshes += 1
      if (!restored) return new Promise<Response>((resolve) => { complete = resolve })
      return Promise.resolve(json(session))
    }
    expect(restored).toBe(true)
    if (request.url.endsWith('/projects')) return Promise.resolve(json([]))
    if (request.url.endsWith('/account')) return Promise.resolve(json({ name: '', theme: null, reminderDays: 0 }))
    reads += 1
    return Promise.resolve(json([{ id: '1', title: 'Persisted task', completed: false }]))
  }))
  const first = render(<Providers><TasksPage /></Providers>)
  await waitFor(() => expect(complete).toBeDefined())
  expect(reads).toBe(0)
  restored = true
  complete!(json(session))
  await screen.findByText('Persisted task')
  first.unmount()
  render(<Providers><TasksPage /></Providers>)
  await screen.findByText('Persisted task')
  expect(reads).toBe(2)
  expect(refreshes).toBe(2)
})

it('does not query or render the task UI for an anonymous visitor', async () => {
  const fetch = vi.fn(async () => json({}, 401))
  stubFetch(fetch)
  render(<Providers><HomePage /></Providers>)
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
  expect(screen.queryByLabelText('Название новой задачи')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('clears private cache on logout and never displays it for the next account', async () => {
  stubFetch(vi.fn(async (request: Request) => {
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
  stubFetch(vi.fn((request: Request) => (
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
  stubFetch(fetch)
  const html = renderToString(<Providers><HomePage /></Providers>)
  expect(html).toContain('Восстанавливаем сессию')
  expect(html).not.toContain('Название новой задачи')
  expect(fetch).not.toHaveBeenCalled()
})

it('saves both views and restores the setting when the workspace remounts', async () => {
  localStorage.setItem('yasno-task-view:2', 'board')
  stubFetch(vi.fn(async (request: Request) => json(
    request.url.endsWith('/tasks') ? [{ id: '1', title: 'Saved view task', completed: false }] : [],
  )))
  const first = renderManager()
  await screen.findByText('Saved view task')
  expect(screen.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Kanban' }))
  expect(localStorage.getItem(preferenceKey)).toBe('board')
  first.unmount()
  renderManager()
  expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск задач' }), { target: { value: 'Saved' } })
  expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Список' }))
  expect(localStorage.getItem(preferenceKey)).toBe('list')
})

it('hydrates the bootstrap shell and opens the saved Kanban without mismatches', async () => {
  localStorage.setItem(preferenceKey, 'board')
  const fetch = vi.fn(async (request: Request) => (
    request.url.endsWith('/auth/refresh')
      ? json(session)
      : json([{ id: '1', title: 'Hydrated task', completed: false }])
  ))
  stubFetch(fetch)
  const container = document.createElement('div')
  container.innerHTML = renderToString(<Providers><TasksPage /></Providers>)
  expect(fetch).not.toHaveBeenCalled()
  document.body.appendChild(container)
  const onRecoverableError = vi.fn()
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    await act(async () => {
      root = hydrateRoot(container, <Providers><TasksPage /></Providers>, { onRecoverableError })
    })
    await screen.findByText('Hydrated task')
    expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true')
    expect(onRecoverableError).not.toHaveBeenCalled()
  } finally {
    act(() => root?.unmount())
    container.remove()
  }
})

it('shows the compact overview with quick creation and puts settings last', async () => {
  stubFetch(async () => json([]))
  renderManager(false)
  expect(screen.getByRole('heading', { name: 'Мой день' })).toBeInTheDocument()
  expect(await screen.findByLabelText('Название новой задачи')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Менеджер задач' })).not.toBeInTheDocument()
  const links = screen.getAllByRole('link').filter(link => link.closest('nav'))
  expect(links.map(link => link.textContent)).toEqual([
    'Обзор', 'Мои задачи', 'Проекты', 'Календарь', 'Аналитика', 'Финансы', 'Настройки',
  ])
  expect(links[0]).toHaveAttribute('aria-current', 'page')
})
