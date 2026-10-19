import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from './index'
import { taskApi } from './api'
import { authReducer, clearSession, setSession } from './auth'
const NativeRequest = globalThis.Request
let store: ReturnType<typeof createStore>
const session = { accessToken: 'old', user: { id: 'user', email: 'one@example.com' } }
const task = { id: '1', title: 'Plan', completed: false }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) { super(typeof input === 'string' ? new URL(input, 'http://localhost:5173') : input, init) }
  })
  store = createStore(); store.dispatch(setSession(session))
})
afterEach(() => { store.dispatch(taskApi.util.resetApiState()); vi.unstubAllGlobals() })
describe('client session and RTK Query', () => {
  it('clears credentials without browser persistence', () => {
    expect(authReducer(authReducer(undefined, setSession(session)), clearSession())).toEqual({ session: null, initialized: true })
  })
  it('uses one refresh for concurrent 401 responses and retries with new access token', async () => {
    let refreshes = 0
    vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
      if (req.url.endsWith('/auth/refresh')) {
        refreshes++
        await new Promise(resolve => setTimeout(resolve, 30))
        return json({ ...session, accessToken: 'new' })
      }
      if (req.headers.get('authorization') === 'Bearer old') return json({}, 401)
      return req.method === 'GET' ? json([task]) : json(task)
    }))
    const results = await Promise.all([
      store.dispatch(taskApi.endpoints.tasks.initiate()).unwrap(),
      store.dispatch(taskApi.endpoints.addTask.initiate('Plan')).unwrap(),
      store.dispatch(taskApi.endpoints.updateTask.initiate({ id: '1', title: 'New' })).unwrap(),
    ])
    expect(results).toHaveLength(3)
    expect(refreshes).toBe(1)
    expect(store.getState().auth.session?.accessToken).toBe('new')
  })
  it('clears auth and private cache when refresh is invalid', async () => {
    await store.dispatch(taskApi.util.upsertQueryData('tasks', undefined, [task]))
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)))
    await store.dispatch(taskApi.endpoints.addTask.initiate('Plan'))
    expect(store.getState().auth.session).toBeNull()
    expect(taskApi.endpoints.tasks.select()(store.getState()).data).toBeUndefined()
  })
  it('updates status optimistically and rolls back a failed request', async () => {
    await store.dispatch(taskApi.util.upsertQueryData('tasks', undefined, [task]))
    let respond: ((value: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve })))
    const pending = store.dispatch(taskApi.endpoints.updateTask.initiate({ id: '1', completed: true }))
    expect(taskApi.endpoints.tasks.select()(store.getState()).data?.[0].completed).toBe(true)
    await vi.waitFor(() => expect(respond).toBeDefined())
    respond?.(json({ message: 'Failed' }, 500))
    await pending
    await vi.waitFor(() => expect(taskApi.endpoints.tasks.select()(store.getState()).data?.[0].completed).toBe(false))
  })
  it('refetches the task list after creating a task', async () => {
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
      if (req.method === 'GET') { reads++; return json(reads === 1 ? [] : [task]) }
      return json(task, 201)
    }))
    const subscription = store.dispatch(taskApi.endpoints.tasks.initiate())
    await subscription.unwrap()
    await store.dispatch(taskApi.endpoints.addTask.initiate('Plan')).unwrap()
    await vi.waitFor(() => expect(taskApi.endpoints.tasks.select()(store.getState()).data).toEqual([task]))
    expect(reads).toBe(2)
    subscription.unsubscribe()
  })
})
