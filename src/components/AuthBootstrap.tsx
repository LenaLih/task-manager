'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAppDispatch, useAppSelector, useAppStore } from '../store'
import { taskApi } from '../store/api'

type AuthBootstrapProps = { children: ReactNode }

export function AuthBootstrap({ children }: AuthBootstrapProps) {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const { initialized, restoring, error } = useAppSelector((state) => state.auth)

  useEffect(() => {
    const auth = store.getState().auth
    if (!auth.initialized && !auth.restoring && !auth.error) {
      void dispatch(taskApi.endpoints.refresh.initiate(undefined, {
        fixedCacheKey: 'session-refresh',
      }))
    }
    // Do not abort a rotating refresh during StrictMode's effect replay.
  }, [dispatch, store])

  function handleRetry(): void {
    void dispatch(taskApi.endpoints.refresh.initiate(undefined, {
      fixedCacheKey: 'session-refresh',
    }))
  }

  if (!initialized) {
    return (
      <main className="workspace">
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button className="add-button" onClick={handleRetry} disabled={restoring}>
              Повторить запрос
            </button>
          </div>
        ) : <p role="status">Восстанавливаем сессию…</p>}
      </main>
    )
  }

  return (
    <>
      {error && (
        <div className="workspace" role="alert">
          <p>{error}</p>
          <button className="add-button" onClick={handleRetry} disabled={restoring}>
            Повторить запрос
          </button>
        </div>
      )}
      {children}
    </>
  )
}
