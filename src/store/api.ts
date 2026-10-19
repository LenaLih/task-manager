import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { Mutex } from 'async-mutex'
import { clearSession, setSession } from './auth'
import type { AuthState, Session } from './auth'
import type { Task } from '../types/task'
const mutex = new Mutex()
const rawQuery = fetchBaseQuery({ baseUrl: '/api', credentials: 'include', prepareHeaders(headers, { getState }) {
  const token = (getState() as { auth: AuthState }).auth.session?.accessToken
  if (token) headers.set('authorization', `Bearer ${token}`)
  return headers
} })
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, options) => {
  await mutex.waitForUnlock()
  const sentToken = (api.getState() as { auth: AuthState }).auth.session?.accessToken
  let result = await rawQuery(args, api, options)
  const url = typeof args === 'string' ? args : args.url
  if (result.error?.status === 401 && !url.startsWith('/auth/')) {
    const currentToken = (api.getState() as { auth: AuthState }).auth.session?.accessToken
    if (!currentToken) return result
    if (sentToken !== currentToken) return rawQuery(args, api, options)
    if (!mutex.isLocked()) {
      const release = await mutex.acquire()
      try {
        const refresh = await rawQuery({ url: '/auth/refresh', method: 'POST' }, api, options)
        if (refresh.data) {
          if ((api.getState() as { auth: AuthState }).auth.session?.accessToken !== sentToken) return result
          api.dispatch(setSession(refresh.data as Session)); result = await rawQuery(args, api, options)
        }
        else if ((api.getState() as { auth: AuthState }).auth.session?.accessToken === sentToken) {
          api.dispatch(clearSession()); api.dispatch(taskApi.util.resetApiState())
        }
      } finally { release() }
    } else {
      await mutex.waitForUnlock()
      if ((api.getState() as { auth: AuthState }).auth.session) result = await rawQuery(args, api, options)
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
