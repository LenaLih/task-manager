'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'

export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const [pending, setPending] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const token = reset ? new URLSearchParams(window.location.hash.slice(1)).get('token') : null
    if (reset && !token) {
      setError('Откройте актуальную ссылку из письма или запросите новую.')
      return
    }
    if (reset && (password.length < 10 || new TextEncoder().encode(password).length > 72)) {
      setError('Пароль должен содержать минимум 10 символов и не более 72 байт UTF-8.')
      return
    }
    if (reset && password !== form.get('confirmation')) {
      setError('Пароли не совпадают.')
      return
    }

    inFlight.current = true
    setPending(true)
    try {
      const response = await fetch(reset ? '/api/auth/reset-password' : '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { token, password } : { email }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(typeof body?.message === 'string' ? body.message : 'Не удалось отправить запрос.')
        return
      }
      if (reset) {
        window.history.replaceState(window.history.state, '', window.location.pathname)
      }
      setComplete(true)
    } catch {
      setError('Не удалось соединиться с сервером. Попробуйте позже.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const backToLogin = (
    <Link href="/login" onClick={reset && complete ? (event) => {
      event.preventDefault()
      window.location.assign('/login')
    } : undefined}>Вернуться ко входу</Link>
  )

  return (
    <>
      <div className="panel-heading">
        <h2>{reset ? 'Новый пароль' : 'Восстановление пароля'}</h2>
      </div>
      {complete ? (
        <div className="auth-form">
          <p role="status">{reset
            ? 'Пароль изменён. Войдите с новым паролем.'
            : 'Если аккаунт существует, мы отправим письмо со ссылкой.'}</p>
          <div className="auth-links">{backToLogin}</div>
        </div>
      ) : (
        <form className="auth-form" method="post" onSubmit={submit} aria-busy={pending}>
          {reset ? (
            <>
              <label>
                Новый пароль
                <input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
              </label>
              <label>
                Повторите пароль
                <input name="confirmation" type="password" autoComplete="new-password" required maxLength={128} />
              </label>
              <p>Минимум 10 символов, максимум 72 байта UTF-8</p>
            </>
          ) : (
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
          )}
          <button className="add-button" type="submit" disabled={pending}>
            {pending ? 'Подождите…' : reset ? 'Сохранить пароль' : 'Отправить ссылку'}
          </button>
          {error && <p role="alert" className="auth-error">{error}</p>}
          <div className="auth-links">
            {backToLogin}
            {reset && <Link href="/forgot-password">Запросить новую ссылку</Link>}
          </div>
        </form>
      )}
    </>
  )
}
