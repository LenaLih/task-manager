import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query'
import type { BaseQueryApi } from '@reduxjs/toolkit/query'
import type { StoreExtra, RefreshResult } from './coordinator'
import { clearSession, setSession, restoreStarted, restoreFailed, invalidatePendingSession } from './auth'
import type { AuthState, Session } from './auth'
import type { Task } from '../types/task'
const rawQuery = fetchBaseQuery({ baseUrl: '/api', credentials: 'include', prepareHeaders(headers, { getState }) {
  const token = (getState() as { auth: AuthState }).auth.session?.accessToken
  if (token) headers.set('authorization', `Bearer ${token}`)
  return headers
} })
const getAuth = (api: BaseQueryApi) => (api.getState() as { auth: AuthState }).auth

function refreshSession(api: BaseQueryApi, options: object): Promise<RefreshResult> {
  const coordinator = (api.extra as StoreExtra).authCoordinator
  if (coordinator.signingOut) {
    return Promise.resolve({ error: { status: 'CUSTOM_ERROR', error: 'Logout in progress' } })
  }
  if (coordinator.refresh) return coordinator.refresh

  const revision = getAuth(api).revision
  api.dispatch(restoreStarted())
  coordinator.refresh = (async () => {
    const release = await coordinator.mutex.acquire()
    try {
      if (getAuth(api).revision !== revision || coordinator.signingOut) {
        return { error: { status: 'CUSTOM_ERROR' as const, error: 'Session changed' } }
      }
      // Do not tie the shared refresh to one component's abort signal.
      const refreshApi = { ...api, signal: new AbortController().signal }
      const result = await rawQuery({ url: '/auth/refresh', method: 'POST' }, refreshApi, options)
      if (getAuth(api).revision !== revision) return result

      if (result.data) {
        api.dispatch(setSession(result.data as Session))
      } else if (result.error?.status === 401) {
        api.dispatch(clearSession())
      } else {
        api.dispatch(restoreFailed())
      }
      return result
    } finally {
      release()
      coordinator.refresh = undefined
    }
  })()
  return coordinator.refresh
}

const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, options) => {
  const coordinator = (api.extra as StoreExtra).authCoordinator
  const url = typeof args === 'string' ? args : args.url
  if (url === '/auth/refresh') return refreshSession(api, options)

  if (url === '/auth/logout') {
    // Invalidate pending responses immediately, before waiting for token rotation.
    coordinator.signingOut = true
    api.dispatch(invalidatePendingSession())
    try {
      await coordinator.mutex.waitForUnlock()
      const result = await rawQuery(args, api, options)
      if (!result.error || result.error.status === 401) {
        api.dispatch(clearSession())
      } else {
        api.dispatch(restoreFailed())
      }
      return result
    } finally {
      coordinator.signingOut = false
    }
  }

  if (url === '/auth/login' || url === '/auth/register') {
    const revision = getAuth(api).revision
    const release = await coordinator.mutex.acquire()
    try {
      if (coordinator.signingOut || getAuth(api).revision !== revision) {
        return { error: { status: 'CUSTOM_ERROR', error: 'Session changed' } }
      }
      const result = await rawQuery(args, api, options)
      if (result.data && getAuth(api).revision === revision) {
        api.dispatch(setSession(result.data as Session))
      }
      return result
    } finally {
      release()
    }
  }

  await coordinator.mutex.waitForUnlock()
  const sentToken = getAuth(api).session?.accessToken
  let result = await rawQuery(args, api, options)

  if (result.error?.status === 401 && !url.startsWith('/auth/')) {
    const currentToken = getAuth(api).session?.accessToken
    if (!currentToken) return result
    if (sentToken !== currentToken) return rawQuery(args, api, options)

    const refresh = await refreshSession(api, options)
    if (getAuth(api).session && getAuth(api).session?.accessToken !== sentToken) {
      result = await rawQuery(args, api, options)
    } else if (refresh.error) {
      return { error: refresh.error }
    }
  }
  return result
}
export const taskApi = createApi({ reducerPath: 'api', baseQuery, tagTypes: ['Task'], endpoints: builder => ({
  login: builder.mutation<Session, { email: string; password: string }>({ query: body => ({ url: '/auth/login', method: 'POST', body }) }),
  register: builder.mutation<Session, { email: string; password: string }>({ query: body => ({ url: '/auth/register', method: 'POST', body }) }),
  refresh: builder.mutation<Session, void>({ query: () => ({ url: '/auth/refresh', method: 'POST' }) }),
  logout: builder.mutation<void, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
  tasks: builder.query<Task[], void>({ query: () => '/tasks', providesTags: result => [{ type: 'Task', id: 'LIST' }, ...(result ?? []).map(t => ({ type: 'Task' as const, id: t.id }))] }),
  addTask: builder.mutation<Task, string>({ query: title => ({ url: '/tasks', method: 'POST', body: { title } }), invalidatesTags: [{ type: 'Task', id: 'LIST' }] }),
  deleteTask: builder.mutation<void, string>({ query: id => ({ url: `/tasks/${id}`, method: 'DELETE' }), invalidatesTags: [{ type: 'Task', id: 'LIST' }] }),
  updateTask: builder.mutation<Task, { id: string; title?: string; completed?: boolean }>({
    query: ({ id, ...body }) => ({ url: `/tasks/${id}`, method: 'PATCH', body }),
    invalidatesTags: (_result, error, arg) => error ? [] : [{ type: 'Task', id: arg.id }],
    async onQueryStarted({ id, completed }, { dispatch, queryFulfilled }) {
      if (completed === undefined) return
      const patch = dispatch(taskApi.util.updateQueryData('tasks', undefined, draft => {
        const task = draft.find(t => t.id === id)
        if (task) task.completed = completed
      }))
      try { await queryFulfilled } catch { patch.undo() }
    },
  }),
}) })
export const { useLoginMutation, useRegisterMutation, useLogoutMutation, useTasksQuery, useAddTaskMutation, useDeleteTaskMutation, useUpdateTaskMutation } = taskApi
