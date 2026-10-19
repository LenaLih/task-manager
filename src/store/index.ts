import { configureStore } from '@reduxjs/toolkit'
import type { Middleware } from '@reduxjs/toolkit'
import { useDispatch, useSelector, useStore } from 'react-redux'
import { authReducer, clearSession, setSession } from './auth'
import type { AuthState } from './auth'
import { taskApi } from './api'
import { createAuthCoordinator } from './coordinator'

// Reset before publishing a different identity; late old query responses are ignored.
const authCacheBoundary: Middleware = ({ dispatch, getState }) => (next) => (action) => {
  const previousUser = (getState() as { auth: AuthState }).auth.session?.user.id
  if (
    clearSession.match(action) ||
    (setSession.match(action) && previousUser !== action.payload.user.id)
  ) {
    dispatch(taskApi.util.resetApiState())
  }
  return next(action)
}

export function createStore() {
  return configureStore({
    reducer: { auth: authReducer, [taskApi.reducerPath]: taskApi.reducer },
    middleware: (getDefault) => getDefault({
      thunk: { extraArgument: { authCoordinator: createAuthCoordinator() } },
    }).concat(authCacheBoundary, taskApi.middleware),
  })
}

export type AppStore = ReturnType<typeof createStore>
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<AppStore>()
