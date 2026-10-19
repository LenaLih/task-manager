// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { createStore } from '../store'
import { AuthPage } from './AuthPage'
import { clearSession, setSession } from '../store/auth'
afterEach(cleanup)
it('shows login after an invalid session on a protected route', () => {
  const store = createStore()
  store.dispatch(setSession({ accessToken: 'expired', user: { id: '1', email: 'a@example.com' } }))
  const view = <Provider store={store}><MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<ProtectedRoute><p>Tasks</p></ProtectedRoute>} /><Route path="/login" element={<AuthPage />} /></Routes></MemoryRouter></Provider>
  render(view)
  expect(screen.getByText('Tasks')).toBeInTheDocument()
  act(() => { store.dispatch(clearSession()) })
  expect(screen.getByRole('heading', { name: 'Вход' })).toBeInTheDocument()
  expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password')
})
