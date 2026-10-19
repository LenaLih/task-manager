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
    expect(authReducer(authReducer(undefined, setSession(session)), clearSession())).toMatchObject({ session: null, initialized: true })
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

it.each([500, 'network'])('keeps the session after refresh failure %s', async (failure) => {
  vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
    if (!req.url.endsWith('/auth/refresh')) return json({}, 401)
    if (failure === 'network') throw new TypeError('Offline')
    return json({}, 500)
  }))
  await store.dispatch(taskApi.endpoints.addTask.initiate('Plan'))
  expect(store.getState().auth.session).toEqual(session)
  expect(store.getState().auth.error).not.toBeNull()
})

it('shares one in-flight explicit refresh within a store', async () => {
  const fetch = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return json({ ...session, accessToken: 'new' })
  })
  vi.stubGlobal('fetch', fetch)
  await Promise.all([
    store.dispatch(taskApi.endpoints.refresh.initiate()),
    store.dispatch(taskApi.endpoints.refresh.initiate()),
  ])
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not restore a session from a response arriving after clearSession', async () => {
  let respond: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
  const pending = store.dispatch(taskApi.endpoints.refresh.initiate())
  await vi.waitFor(() => expect(respond).toBeDefined())
  store.dispatch(clearSession())
  respond!(json({ ...session, accessToken: 'late' }))
  await pending
  expect(store.getState().auth.session).toBeNull()
})

it('waits for refresh before logout and never installs the late access token', async () => {
  let respond: ((response: Response) => void) | undefined
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn((req: Request) => {
    calls.push(req.url)
    if (req.url.endsWith('/auth/refresh')) {
      return new Promise<Response>((resolve) => { respond = resolve })
    }
    return Promise.resolve(new Response(null, { status: 204 }))
  }))
  const observed: (string | undefined)[] = []
  const unsubscribe = store.subscribe(() => observed.push(store.getState().auth.session?.accessToken))
  const refresh = store.dispatch(taskApi.endpoints.refresh.initiate())
  await vi.waitFor(() => expect(respond).toBeDefined())
  const logout = store.dispatch(taskApi.endpoints.logout.initiate())
  expect(calls).toHaveLength(1)
  respond!(json({ ...session, accessToken: 'late' }))
  await Promise.all([refresh, logout])
  unsubscribe()
  expect(observed).not.toContain('late')
  expect(calls.map((url) => url.split('/').at(-1))).toEqual(['refresh', 'logout'])
  expect(store.getState().auth.session).toBeNull()
})

it('does not install a login response that arrives after logout', async () => {
  let respond: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn((req: Request) => (
    req.url.endsWith('/auth/login')
      ? new Promise<Response>((resolve) => { respond = resolve })
      : Promise.resolve(new Response(null, { status: 204 }))
  )))
  const login = store.dispatch(taskApi.endpoints.login.initiate({ email: session.user.email, password: 'password' }))
  await vi.waitFor(() => expect(respond).toBeDefined())
  const logout = store.dispatch(taskApi.endpoints.logout.initiate())
  respond!(json({ ...session, accessToken: 'late-login' }))
  await Promise.all([login, logout])
  expect(store.getState().auth.session).toBeNull()
})

it('keeps the session if logout encounters a server failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)))
  await store.dispatch(taskApi.endpoints.logout.initiate())
  expect(store.getState().auth.session).toEqual(session)
  expect(store.getState().auth.error).not.toBeNull()
})

it('ignores an old account response arriving after the new account query', async () => {
  let complete: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn((req: Request) => (
    req.headers.get('authorization') === 'Bearer old'
      ? new Promise<Response>((resolve) => { complete = resolve })
      : Promise.resolve(json([{ ...task, id: '2', title: 'Second user' }]))
  )))
  const oldRequest = store.dispatch(taskApi.endpoints.tasks.initiate())
  await vi.waitFor(() => expect(complete).toBeDefined())
  store.dispatch(setSession({ accessToken: 'second', user: { id: 'second', email: 'two@example.com' } }))
  const newRequest = store.dispatch(taskApi.endpoints.tasks.initiate())
  await newRequest.unwrap()
  complete!(json([{ ...task, title: 'First user secret' }]))
  await oldRequest
  expect(taskApi.endpoints.tasks.select()(store.getState()).data).toEqual([
    { ...task, id: '2', title: 'Second user' },
  ])
  oldRequest.unsubscribe()
  newRequest.unsubscribe()
})

it('clears cached tasks on clearSession even outside an API logout', async () => {
  await store.dispatch(taskApi.util.upsertQueryData('tasks', undefined, [task]))
  store.dispatch(clearSession())
  expect(taskApi.endpoints.tasks.select()(store.getState()).data).toBeUndefined()
})
