import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query'
import type { BaseQueryApi } from '@reduxjs/toolkit/query'
import type { StoreExtra, RefreshResult } from './coordinator'
import { clearSession, setSession, restoreStarted, restoreFailed, invalidatePendingSession, updateSessionEmail } from './auth'
import type { AuthState, Session } from './auth'
import type { BulkAction, HistoryEntry, Project, ProjectDraft, Task, WorkspaceTask } from '../types/task'
import type { Analytics } from '../types/planning'
import type { ActiveSession, Profile, SavedFilter } from '../types/workspace'
import type { FinanceSnapshot } from '../types/finance'
const rawQuery = fetchBaseQuery({ baseUrl: '/api', credentials: 'include', prepareHeaders(headers, { getState }) {
  const token = (getState() as { auth: AuthState }).auth.session?.accessToken
  if (token) headers.set('authorization', `Bearer ${token}`)
  return headers
} })
const getAuth = (api: Pick<BaseQueryApi, 'getState'>) => (api.getState() as { auth: AuthState }).auth

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
export const taskApi = createApi({ reducerPath: 'api', baseQuery, tagTypes: ['Task', 'Project', 'History', 'Profile', 'Session', 'Filter', 'Finance'], endpoints: builder => ({
  finance: builder.query<FinanceSnapshot, void>({ query: () => '/finance', providesTags: ['Finance'] }),
  writeFinance: builder.mutation<void, { resource: keyof FinanceSnapshot; id: string; body?: object; patch?: boolean }>({
    query: ({ resource, id, body, patch }) => ({
      url: `/finance/${resource}/${encodeURIComponent(id)}`, method: patch ? 'PATCH' : body ? 'PUT' : 'DELETE', body,
    }),
    invalidatesTags: (_result, error) => error ? [] : ['Finance'],
  }),
  login: builder.mutation<Session, { email: string; password: string }>({ query: body => ({ url: '/auth/login', method: 'POST', body }) }),
  register: builder.mutation<Session, { email: string; password: string }>({ query: body => ({ url: '/auth/register', method: 'POST', body }) }),
  refresh: builder.mutation<Session, void>({ query: () => ({ url: '/auth/refresh', method: 'POST' }) }),
  logout: builder.mutation<void, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
  profile: builder.query<Profile, void>({ query: () => '/account', providesTags: ['Profile'] }),
  updateProfile: builder.mutation<Profile, Partial<Omit<Profile, 'email' | 'theme'> & { theme: 'light' | 'dark' }>>({
    query: body => ({ url: '/account', method: 'PATCH', body }),
    invalidatesTags: result => result ? ['Profile'] : [],
  }),
  requestEmail: builder.mutation<void, { email: string; currentPassword: string }>({
    query: body => ({ url: '/account/email', method: 'POST', body }),
  }),
  confirmEmail: builder.mutation<Profile, { code: string }>({
    query: body => ({ url: '/account/email/confirm', method: 'POST', body }),
    invalidatesTags: result => result ? ['Profile'] : [],
    async onQueryStarted(_body, { dispatch, getState, queryFulfilled }) {
      const owner = getAuth({ getState }).session?.user.id
      try {
        const { data } = await queryFulfilled
        if (owner && getAuth({ getState }).session?.user.id === owner) dispatch(updateSessionEmail(data.email))
      } catch { /* handled in the form */ }
    },
  }),
  changePassword: builder.mutation<void, { currentPassword: string; password: string; confirmation: string }>({
    query: body => ({ url: '/account/password', method: 'POST', body }),
  }),
  sessions: builder.query<ActiveSession[], void>({ query: () => '/account/sessions', providesTags: ['Session'] }),
  revokeSessions: builder.mutation<void, string | void>({
    query: id => ({ url: '/account/sessions' + (id ? '/' + encodeURIComponent(id) : ''), method: 'DELETE' }),
    invalidatesTags: (_result, error) => error ? [] : ['Session'],
  }),
  savedFilters: builder.query<SavedFilter[], void>({ query: () => '/account/filters', providesTags: ['Filter'] }),
  saveFilter: builder.mutation<void, SavedFilter>({
    query: body => ({ url: '/account/filters', method: 'PUT', body }),
    invalidatesTags: (_result, error) => error ? [] : ['Filter'],
  }),
  deleteFilter: builder.mutation<void, string>({
    query: name => ({ url: '/account/filters', method: 'DELETE', body: { name } }),
    invalidatesTags: (_result, error) => error ? [] : ['Filter'],
  }),
  exportTasks: builder.mutation<string, 'csv' | 'json'>({
    query: format => ({
      url: '/tasks/export/' + format,
      responseHandler: response => response.ok ? response.text() : response.json(),
    }),
  }),
  task: builder.query<WorkspaceTask, string>({
    query: id => '/tasks/' + encodeURIComponent(id), providesTags: (_result, _error, id) => [{ type: 'Task', id }],
  }),
  tasks: builder.query<WorkspaceTask[], void>({ query: () => '/tasks', providesTags: result => [{ type: 'Task', id: 'LIST' }, ...(result ?? []).map(t => ({ type: 'Task' as const, id: t.id }))] }),
  projects: builder.query<Project[], void>({ query: () => '/projects', providesTags: ['Project'] }),
  analytics: builder.query<Analytics, { days: 7 | 30 | 90; zone: string }>({
    query: params => ({ url: '/analytics', params }),
    providesTags: ['Project', { type: 'Task', id: 'LIST' }],
  }),
  project: builder.query<Project, string>({
    query: id => '/projects/' + encodeURIComponent(id), providesTags: ['Project'],
  }),
  addProject: builder.mutation<Project, ProjectDraft>({
    query: body => ({ url: '/projects', method: 'POST', body }),
    invalidatesTags: (_result, error) => error ? [] : ['Project'],
  }),
  updateProject: builder.mutation<void, Partial<ProjectDraft> & Pick<Project, 'id'> & { archived?: boolean }>({
    query: ({ id, ...body }) => ({ url: '/projects/' + encodeURIComponent(id), method: 'PATCH', body }),
    invalidatesTags: (_result, error) => error ? [] : ['Project'],
  }),
  taskHistory: builder.query<HistoryEntry[], string>({
    query: id => '/tasks/' + encodeURIComponent(id) + '/history',
    providesTags: (_result, _error, id) => [{ type: 'History', id }],
  }),
  bulkTasks: builder.mutation<void, { ids: string[]; action: BulkAction }>({
    query: body => ({ url: '/tasks/bulk', method: 'POST', body }),
    invalidatesTags: (_result, error, { ids }) => error ? [] : [
      { type: 'Task', id: 'LIST' }, 'Project', ...ids.map(id => ({ type: 'History' as const, id })),
    ],
  }),
  addTask: builder.mutation<WorkspaceTask, string | Omit<WorkspaceTask, 'id' | 'completed'>>({
    query: task => ({ url: '/tasks', method: 'POST', body: typeof task === 'string' ? { title: task } : task }),
    invalidatesTags: (_result, error) => error ? [] : [{ type: 'Task', id: 'LIST' }, 'Project'],
  }),
  deleteTask: builder.mutation<void, string>({
    query: id => ({ url: `/tasks/${id}`, method: 'DELETE' }),
    invalidatesTags: (_result, error, id) => error ? [] : [
      { type: 'Task', id: 'LIST' }, { type: 'Task', id }, 'Project', { type: 'History', id },
    ],
  }),
  updateTask: builder.mutation<WorkspaceTask, Partial<WorkspaceTask> & Pick<Task, 'id'>>({
    query: ({ id, ...body }) => ({ url: `/tasks/${id}`, method: 'PATCH', body }),
    invalidatesTags: (_result, error, arg) => error ? [] : [
      { type: 'Task', id: arg.id }, 'Project', { type: 'History', id: arg.id },
    ],
    async onQueryStarted({ id, completed }, { dispatch, queryFulfilled }) {
      if (completed === undefined) return
      const patch = dispatch(taskApi.util.updateQueryData('tasks', undefined, draft => {
        const task = draft.find(t => t.id === id)
        if (task) {
          task.completed = completed
          if (completed) task.status = 'done'
          else if (task.status === 'done') task.status = 'todo'
        }
      }))
      try { await queryFulfilled } catch { patch.undo() }
    },
  }),
}) })
export const { useLoginMutation, useRegisterMutation, useLogoutMutation, useTasksQuery, useAddTaskMutation, useDeleteTaskMutation, useUpdateTaskMutation } = taskApi
export const { useProjectsQuery, useProjectQuery, useAddProjectMutation, useUpdateProjectMutation,
  useTaskHistoryQuery, useBulkTasksMutation, useAnalyticsQuery } = taskApi
export const { useProfileQuery, useUpdateProfileMutation, useRequestEmailMutation, useConfirmEmailMutation,
  useChangePasswordMutation, useSessionsQuery, useRevokeSessionsMutation, useSavedFiltersQuery,
  useSaveFilterMutation, useDeleteFilterMutation, useExportTasksMutation, useTaskQuery } = taskApi
