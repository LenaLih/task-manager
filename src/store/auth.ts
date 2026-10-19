import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
export interface Session { accessToken: string; user: { id: string; email: string } }
export interface AuthState { session: Session | null; initialized: boolean }
const initialState: AuthState = { session: null, initialized: false }
const slice = createSlice({ name: 'auth', initialState, reducers: {
  setSession(state, action: PayloadAction<Session>) { state.session = action.payload; state.initialized = true },
  clearSession(state) { state.session = null; state.initialized = true },
} })
export const { setSession, clearSession } = slice.actions
export const authReducer = slice.reducer
