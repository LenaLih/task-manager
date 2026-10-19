'use client'

import { useState } from 'react'
import { useLogoutMutation } from '../store/api'
import { useAppSelector } from '../store'

export function SessionControls() {
  const session = useAppSelector((state) => state.auth.session)
  const [logout, { isLoading }] = useLogoutMutation()
  const [error, setError] = useState(false)

  async function handleLogout(): Promise<void> {
    setError(false)
    try {
      await logout().unwrap()
    } catch {
      setError(true)
    }
  }

  return (
    <div className="workspace">
      <div className="account">
        <span>{session?.user.email}</span>
        <button disabled={isLoading} onClick={() => void handleLogout()}>
          Выйти
        </button>
      </div>
      {error && <p role="alert">Не удалось выйти. Повторите попытку.</p>}
    </div>
  )
}
