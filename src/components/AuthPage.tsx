'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLoginMutation, useRegisterMutation } from '../store/api'
import { useAppSelector } from '../store'

type AuthPageProps = { register?: boolean }

function getAuthError(error: unknown, register: boolean): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status
    if (status === 'FETCH_ERROR' || status === 'TIMEOUT_ERROR') {
      return 'Не удалось соединиться с сервером. Проверьте подключение к интернету и повторите попытку.'
    }
    if (
      (typeof status === 'number' && status >= 500) ||
      (status === 'PARSING_ERROR' && 'originalStatus' in error &&
        typeof error.originalStatus === 'number' && error.originalStatus >= 500)
    ) {
      return 'Сервис временно недоступен. Попробуйте позже'
    }
    if (!register && (status === 401 || status === 400)) {
      return 'Неверный email или пароль'
    }
    if (status === 429) return 'Слишком много попыток. Попробуйте позже.'
  }
  return register
    ? 'Не удалось создать аккаунт. Проверьте данные или попробуйте войти.'
    : 'Не удалось войти. Повторите попытку.'
}

function validateEmail(value: string): string {
  const email = value.trim()
  if (!email) return 'Введите email'
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? ''
    : 'Некорректный email'
}

function validatePassword(value: string, register: boolean): string {
  if (!value) return 'Введите пароль'
  if (register && (
    value.length < 10 || value.length > 128 ||
    new TextEncoder().encode(value).length > 72
  )) {
    return 'Пароль должен содержать минимум 10 символов и не более 72 байт UTF-8.'
  }
  return ''
}

export function AuthPage({ register = false }: AuthPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({ email: '', password: '', form: '' })
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const errorId = useId()
  const emailErrorId = errorId + '-email'
  const passwordErrorId = errorId + '-password'
  const formErrorId = errorId + '-form'
  const [login, loginState] = useLoginMutation()
  const [signup, signupState] = useRegisterMutation()
  const router = useRouter()
  const session = useAppSelector((state) => state.auth.session)
  const pending = submitting || loginState.isLoading || signupState.isLoading

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.currentTarget.value
    setEmail(value)
    setErrors((previous) => ({
      ...previous,
      email: previous.email ? validateEmail(value) : '',
      // The credential error belongs to the email/password pair, not just password.
      password: previous.password === 'Неверный email или пароль' ? '' : previous.password,
    }))
  }

  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.currentTarget.value
    setPassword(value)
    setErrors((previous) => ({
      ...previous,
      password: previous.password ? validatePassword(value, register) : '',
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (inFlight.current || pending) return

    const nextErrors = {
      email: validateEmail(email),
      password: validatePassword(password, register),
      form: '',
    }
    setErrors(nextErrors)
    if (nextErrors.email || nextErrors.password) return

    const normalizedEmail = email.trim()

    // Block duplicate submits synchronously, before React re-renders.
    inFlight.current = true
    setSubmitting(true)
    try {
      const authenticate = register ? signup : login
      await authenticate({ email: normalizedEmail, password }).unwrap()
    } catch (requestError) {
      const message = getAuthError(requestError, register)
      const invalidCredentials = !register &&
        typeof requestError === 'object' && requestError !== null &&
        'status' in requestError &&
        (requestError.status === 401 || requestError.status === 400)
      setErrors({
        email: '',
        password: invalidCredentials ? message : '',
        form: invalidCredentials ? '' : message,
      })
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (session) router.replace('/')
  }, [router, session])

  if (session) return null

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
        <form
          className="auth-form"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={pending}
          aria-describedby={errors.form ? formErrorId : undefined}
        >
          <div>
            <label>
              Email
              <input
                type="email"
                aria-invalid={Boolean(errors.email) || undefined}
                aria-describedby={errors.email ? emailErrorId : undefined}
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={handleEmailChange}
              />
            </label>
            {errors.email && (
              <p id={emailErrorId} className="auth-error" role="alert">{errors.email}</p>
            )}
          </div>
          <div>
            <label>
              Пароль
              <input
                type="password"
                aria-invalid={Boolean(errors.password) || undefined}
                aria-describedby={errors.password ? passwordErrorId : undefined}
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={register ? 10 : undefined}
                maxLength={128}
                value={password}
                onChange={handlePasswordChange}
              />
            </label>
            {errors.password && (
              <p id={passwordErrorId} className="auth-error" role="alert">{errors.password}</p>
            )}
          </div>
          <p>Минимум 10 символов, максимум 72 байта UTF-8</p>
          <button className="add-button" disabled={pending} type="submit">
            {pending ? 'Подождите…' : register ? 'Создать аккаунт' : 'Войти'}
          </button>
          {errors.form && <p id={formErrorId} className="auth-error" role="alert">{errors.form}</p>}
          <Link href={register ? '/login' : '/register'}>
            {register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'}
          </Link>
        </form>
      </section>
    </main>
  )
}
