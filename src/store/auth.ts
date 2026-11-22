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
  notice?: 'password-changed'
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
    updateSessionEmail(state, action: PayloadAction<string>) {
      if (state.session) state.session.user.email = action.payload
    },
    setSession(state, action: PayloadAction<Session>) {
      state.session = action.payload
      state.initialized = true
      state.restoring = false
      state.error = null
      state.revision += 1
      state.notice = undefined
    },
    clearSession(state, action: PayloadAction<AuthState['notice']>) {
      state.session = null
      state.initialized = true
      state.restoring = false
      state.error = null
      state.revision += 1
      state.notice = action.payload
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

export const { setSession, clearSession, restoreStarted, restoreFailed, invalidatePendingSession, updateSessionEmail } = slice.actions
export const authReducer = slice.reducer
