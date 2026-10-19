import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

export interface Session {
  accessToken: string
  user: { id: string; email: string }
}

export interface AuthState {
  session: Session | null
  initialized: boolean
  restoring: boolean
  error: string | null
  revision: number
}

const initialState: AuthState = {
  session: null,
  initialized: false,
  restoring: false,
  error: null,
  revision: 0,
}

const slice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setSession(state, action: PayloadAction<Session>) {
      state.session = action.payload
      state.initialized = true
      state.restoring = false
      state.error = null
      state.revision += 1
    },
    clearSession(state) {
      state.session = null
      state.initialized = true
      state.restoring = false
      state.error = null
      state.revision += 1
    },
    invalidatePendingSession(state) {
      state.revision += 1
    },
    restoreStarted(state) {
      state.restoring = true
      state.error = null
    },
    restoreFailed(state) {
      state.restoring = false
      state.error = 'Не удалось восстановить сессию. Проверьте соединение и повторите запрос.'
    },
  },
})

export const { setSession, clearSession, restoreStarted, restoreFailed, invalidatePendingSession } = slice.actions
export const authReducer = slice.reducer
