import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useLoginMutation, useRegisterMutation } from '../store/api'
import { useAppDispatch, useAppSelector } from '../store'
import { setSession } from '../store/auth'

type AuthPageProps = {
  register?: boolean
}

export function AuthPage({ register = false }: AuthPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [login, loginState] = useLoginMutation()
  const [signup, signupState] = useRegisterMutation()
  const dispatch = useAppDispatch()
  const session = useAppSelector((state) => state.auth.session)
  const pending = loginState.isLoading || signupState.isLoading

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>): void {
    setEmail(event.currentTarget.value)
  }

  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>): void {
    setPassword(event.currentTarget.value)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError('')

    try {
      const authenticate = register ? signup : login
      const session = await authenticate({ email, password }).unwrap()
      dispatch(setSession(session))
    } catch {
      setError(
        register
          ? 'Не удалось зарегистрироваться. Проверьте данные: возможно, email уже занят.'
          : 'Не удалось войти. Проверьте email, пароль и соединение.',
      )
    }
  }

  if (session) return <Navigate to="/" replace />

  return (
    <main className="workspace">
      <section className="intro">
        <h1>ясно<span className="brand-dot">.</span></h1>
        <p>Меньше шума. Больше фокуса.</p>
      </section>
      <section className="task-panel">
        <div className="panel-heading">
          <h2>{register ? 'Регистрация' : 'Вход'}</h2>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={handleEmailChange}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={handlePasswordChange}
            />
          </label>
          <p>Минимум 10 символов, максимум 72 байта UTF-8</p>
          <button className="add-button" disabled={pending}>
            {pending ? 'Подождите…' : register ? 'Создать аккаунт' : 'Войти'}
          </button>
          {error && <p role="alert">{error}</p>}
          <Link to={register ? '/login' : '/register'}>
            {register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'}
          </Link>
        </form>
      </section>
    </main>
  )
}
