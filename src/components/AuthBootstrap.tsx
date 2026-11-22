'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppDispatch, useAppSelector, useAppStore } from '../store'
import { taskApi } from '../store/api'
import { ErrorState } from './ErrorState'

type AuthBootstrapProps = { children: ReactNode }

export function AuthBootstrap({ children }: AuthBootstrapProps) {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const { initialized, restoring, error } = useAppSelector((state) => state.auth)
  const [retrying, setRetrying] = useState(false)

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
    setRetrying(true)
    void dispatch(taskApi.endpoints.refresh.initiate(undefined, {
      fixedCacheKey: 'session-refresh',
    })).finally(() => setRetrying(false))
  }

  const recoveryState = (error || retrying) && (
    <ErrorState message={error ?? 'Восстанавливаем сессию…'} retryLabel="Повторить запрос"
      pending={restoring || retrying} onRetry={handleRetry} />
  )

  if (!initialized) {
    return (
      <main className="workspace">
        {recoveryState || <p role="status">Восстанавливаем сессию…</p>}
      </main>
    )
  }

  return (
    <>
      {recoveryState && <div className="workspace">{recoveryState}</div>}
      {children}
    </>
  )
}
