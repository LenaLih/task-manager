import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthPage } from './components/LegacyAuthPage'
import TaskManager from './components/TaskManager'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAppSelector } from './store'
import { store } from './store/legacy'
import { taskApi } from './store/api'
import { clearSession, setSession } from './store/auth'
import './App.css'

let bootstrap: Promise<void> | undefined

function initializeSession(): Promise<void> {
  bootstrap ??= (async () => {
    try {
      const session = await store.dispatch(
        taskApi.endpoints.refresh.initiate(),
      ).unwrap()
      store.dispatch(setSession(session))
    } catch {
      store.dispatch(clearSession())
    }
  })()

  return bootstrap
}

function App() {
  const auth = useAppSelector((state) => state.auth)

  useEffect(() => {
    void initializeSession()
  }, [])

  if (!auth.initialized) {
    return (
      <main className="workspace" role="status">
        Восстанавливаем сессию…
      </main>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <TaskManager />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
