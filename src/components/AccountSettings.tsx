'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { clearSession } from '../store/auth'
import { requestMessage } from '../store/requestMessage'
import {
  useChangePasswordMutation, useConfirmEmailMutation, useExportTasksMutation, useProfileQuery,
  useRequestEmailMutation, useRevokeSessionsMutation, useSessionsQuery, useUpdateProfileMutation,
} from '../store/api'
import { ErrorState } from './ErrorState'

function SettingsForm({ title, label, children, save, success, reset = false, heading: Heading = 'h2' }: {
  title: string; label: string; children: ReactNode; save: (data: FormData) => Promise<unknown>; success: string; reset?: boolean; heading?: 'h2' | 'h3'
}) {
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const errorId = useId()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    submitting.current = true
    setPending(true)
    setError('')
    setMessage('')
    try {
      await save(data)
      if (reset) form.reset()
      setMessage(success)
    } catch (failure) {
      setError(requestMessage(failure))
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return <form className="work-settings-card" onSubmit={submit} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
    <Heading>{title}</Heading>
    <fieldset disabled={pending}>{children}<button className="add-button" type="submit">{pending ? 'Отправляем…' : label}</button></fieldset>
    {error && <p id={errorId} className="work-error" role="alert">{error}</p>}
    {message && <p className="work-settings-success" role="status">{message}</p>}
  </form>
}

const value = (data: FormData, key: string) => String(data.get(key) ?? '')

function EmailSettings({ owner, email }: { owner: string; email: string }) {
  const key = `yasno-email-change:${owner}`
  const [destination, setDestination] = useState(() => {
    try {
      const address = sessionStorage.getItem(key) ?? ''
      return address === email ? '' : address
    } catch { return '' }
  })
  const [step, setStep] = useState<'request' | 'confirm' | 'resend'>(() => destination ? 'confirm' : 'request')
  const [draft, setDraft] = useState(destination)
  const [error, setError] = useState('')
  const [invalidField, setInvalidField] = useState<'code' | 'password' | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const focusOnChange = useRef(false)
  const firstField = useRef<HTMLInputElement>(null)
  const [requestCode] = useRequestEmailMutation()
  const [confirmCode] = useConfirmEmailMutation()

  useEffect(() => {
    if (focusOnChange.current) {
      firstField.current?.focus()
      focusOnChange.current = false
    }
  }, [step])

  function go(next: typeof step) {
    setError('')
    setInvalidField(null)
    setSuccess(false)
    focusOnChange.current = true
    setStep(next)
  }

  function remember(address: string) {
    setDestination(address)
    try {
      if (address) sessionStorage.setItem(key, address)
      else sessionStorage.removeItem(key)
    } catch { /* The current page still retains the address. */ }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    submitting.current = true
    setBusy(true)
    setError('')
    setInvalidField(null)
    setSuccess(false)
    try {
      if (step === 'confirm') {
        await confirmCode({ code: value(data, 'code').trim() }).unwrap()
        remember('')
        setDraft('')
        go('request')
        setSuccess(true)
      } else {
        const address = (step === 'resend' ? destination : draft).trim().toLowerCase()
        await requestCode({ email: address, currentPassword: value(data, 'current') }).unwrap()
        remember(address)
        setDraft(address)
        go('confirm')
      }
      form.reset()
    } catch (failure) {
      setError(requestMessage(failure))
      if (failure && typeof failure === 'object' && 'status' in failure) {
        if (step === 'confirm' && failure.status === 400) setInvalidField('code')
        if (step !== 'confirm' && failure.status === 403) setInvalidField('password')
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const label = step === 'confirm' ? 'Подтвердить email' : step === 'resend' ? 'Отправить новый код' : 'Отправить код'
  return <section className="work-settings-card" aria-labelledby="settings-email-title">
    <h2 id="settings-email-title">Электронная почта</h2>
    <p id="settings-email-hint" className="work-settings-hint" role={step === 'confirm' ? 'status' : undefined}>
      {step === 'confirm' ? <>Код отправлен на <strong>{destination}</strong>. Он действует 15 минут.</> :
        step === 'resend' ? <>Введите текущий пароль, чтобы получить новый код для <strong>{destination}</strong>.</> :
          'Укажите новый адрес и подтвердите его кодом из письма.'}
    </p>
    <form key={step} onSubmit={submit} aria-busy={busy} aria-describedby={error ? 'settings-email-error' : undefined}>
      <fieldset disabled={busy}>
        {step === 'confirm' ? <label>Код из письма<input ref={firstField} name="code" required maxLength={43}
          autoComplete="one-time-code" spellCheck={false} aria-invalid={invalidField === 'code' || undefined}
          aria-describedby={invalidField === 'code' ? 'settings-email-hint settings-email-error' : 'settings-email-hint'} /></label> : <>
          {step === 'request' && <label>Новый email<input ref={firstField} type="email" name="email" value={draft}
            onChange={event => setDraft(event.target.value)} maxLength={254} required autoComplete="email" /></label>}
          <label>Пароль для смены email<input ref={step === 'resend' ? firstField : undefined}
            type="password" name="current" required autoComplete="current-password"
            aria-invalid={invalidField === 'password' || undefined}
            aria-describedby={invalidField === 'password' ? 'settings-email-error' : undefined} /></label>
        </>}
        <div className="work-settings-actions">
          <button className="add-button" type="submit">{busy ? 'Подождите…' : label}</button>
          {step !== 'confirm' && destination && <button type="button" onClick={() => go('confirm')}>Вернуться к коду</button>}
        </div>
        {step === 'confirm' && <div className="work-settings-actions">
          <button type="button" onClick={() => go('resend')}>Отправить повторно</button>
          <button type="button" onClick={() => go('request')}>Изменить адрес</button>
        </div>}
      </fieldset>
    </form>
    {error && <p className="work-error" role="alert" id="settings-email-error">{error}</p>}
    {success && <p className="work-settings-success" role="status">Email изменён.</p>}
    {step === 'request' && draft.trim().toLowerCase() === email && <p className="work-settings-hint">Укажите адрес, отличный от текущего.</p>}
  </section>
}

function PasswordSettings() {
  const [show, setShow] = useState(false)
  const [changePassword] = useChangePasswordMutation()
  const dispatch = useAppDispatch()
  const type = show ? 'text' : 'password'
  return <SettingsForm title="Смена пароля" heading="h3" label="Сменить пароль" success="Пароль изменён." reset
    save={async data => {
      const password = value(data, 'password')
      const confirmation = value(data, 'confirmation')
      if (password !== confirmation) throw { data: { message: 'Новые пароли не совпадают.' } }
      if (new TextEncoder().encode(password).length > 72) throw { data: { message: 'Новый пароль превышает 72 байта UTF-8.' } }
      await changePassword({ currentPassword: value(data, 'current'), password, confirmation }).unwrap()
      dispatch(clearSession('password-changed'))
    }}>
    <p className="work-settings-hint">После смены пароля потребуется заново войти на каждом устройстве.</p>
    <label>Текущий пароль<input type={type} name="current" required autoComplete="current-password" /></label>
    <label>Новый пароль<input type={type} name="password" required minLength={10} maxLength={72}
      autoComplete="new-password" aria-describedby="settings-password-rules" /></label>
    <p className="work-settings-hint" id="settings-password-rules">Минимум 10 символов, максимум 72 байта UTF-8.</p>
    <label>Подтвердите новый пароль<input type={type} name="confirmation" required minLength={10} maxLength={72} autoComplete="new-password" /></label>
    <button type="button" aria-pressed={show} onClick={() => setShow(!show)}>Показать пароли</button>
  </SettingsForm>
}

function deviceLabel(agent: string) {
  const browsers = [
    [/Edg(?:A|iOS)?\//, 'Edge'], [/Firefox\/|FxiOS\//, 'Firefox'], [/Chrome\/|CriOS\//, 'Chrome'], [/Safari\//, 'Safari'],
  ] as const
  const browser = browsers.find(([pattern]) => pattern.test(agent))?.[1]
  const platform = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' :
    /Windows/.test(agent) ? 'Windows' : /Macintosh/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : undefined
  return [browser, platform].filter(Boolean).join(' · ') || 'Устройство неизвестно'
}

function SessionSettings() {
  const sessions = useSessionsQuery(undefined, { refetchOnMountOrArgChange: true })
  const [revoke, state] = useRevokeSessionsMutation()
  const [feedback, setFeedback] = useState('')
  const [confirm, setConfirm] = useState(false)
  const sending = useRef(false)
  const confirmButton = useRef<HTMLButtonElement>(null)
  async function end(id?: string) {
    if (sending.current) return
    sending.current = true
    setFeedback('')
    try { await revoke(id).unwrap(); setConfirm(false); setFeedback(id ? 'Сессия завершена.' : 'Остальные сессии завершены.') }
    catch (error) { setFeedback(requestMessage(error)) }
    finally { sending.current = false }
  }
  return <section className="work-settings-card" aria-busy={state.isLoading}>
    <h3>Активные сессии</h3>
    {sessions.isLoading && <p role="status">Загружаем сессии…</p>}
    {sessions.isError && <ErrorState message="Не удалось загрузить сессии." retryLabel="Повторить"
      pending={sessions.isFetching} onRetry={sessions.refetch} />}
    {sessions.data && <ul className="work-sessions">
      {sessions.data.map(({ id, device, createdAt, current, expires }) => <li key={id}>
        <div>
          <strong className={current ? 'work-session-current' : undefined}>{current ? 'Текущая сессия' : 'Другая сессия'}</strong>
          <small title={device || undefined}>{deviceLabel(device)}</small>
          <small>Начало {new Date(createdAt).toLocaleString('ru-RU')} · До {new Date(expires).toLocaleString('ru-RU')}</small>
        </div>
        {!current && <button type="button" disabled={state.isLoading} onClick={() => void end(id)}>Завершить</button>}
      </li>)}
    </ul>}
    <button ref={confirmButton} type="button" aria-expanded={confirm}
      disabled={state.isLoading || !sessions.data?.some(session => !session.current)}
      onClick={() => setConfirm(open => !open)}>Завершить остальные сессии</button>
    {confirm && <div className="work-settings-confirm" role="group" aria-label="Подтверждение завершения сессий">
      <p>На других устройствах потребуется заново войти.</p>
      <div className="work-settings-actions">
        <button type="button" className="add-button" disabled={state.isLoading} onClick={() => void end()}>
          {state.isLoading ? 'Завершаем…' : 'Подтвердить завершение'}
        </button>
        <button type="button" disabled={state.isLoading} onClick={() => { setConfirm(false); confirmButton.current?.focus() }}>Отмена</button>
      </div>
    </div>}
    {feedback && <p className={state.isError ? 'work-error' : 'work-settings-success'} role={state.isError ? 'alert' : 'status'}>{feedback}</p>}
  </section>
}

function ExportSettings() {
  const [exportTasks, state] = useExportTasksMutation()
  const [feedback, setFeedback] = useState('')
  async function download(format: 'csv' | 'json') {
    setFeedback('')
    try {
      const content = await exportTasks(format).unwrap()
      const url = URL.createObjectURL(new Blob([format === 'csv' ? '\uFEFF' + content.replace(/^\uFEFF/, '') : content],
        { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'yasno-tasks.' + format
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setFeedback('Файл подготовлен.')
    } catch (error) { setFeedback(requestMessage(error)) }
  }
  return <section className="work-settings-card" aria-busy={state.isLoading}>
    <h2>Экспорт задач</h2>
    <div className="work-settings-actions">
      <button type="button" disabled={state.isLoading} onClick={() => void download('csv')}>Скачать CSV</button>
      <button type="button" disabled={state.isLoading} onClick={() => void download('json')}>Скачать JSON</button>
    </div>
    {state.isLoading && <p role="status">Готовим файл…</p>}
    {feedback && <p className={state.isError ? 'work-error' : 'work-settings-success'} role={state.isError ? 'alert' : 'status'}>{feedback}</p>}
  </section>
}

export function AccountSettings({ theme }: { theme: 'light' | 'dark' }) {
  const profile = useProfileQuery()
  const [update] = useUpdateProfileMutation()
  const owner = useAppSelector(state => state.auth.session?.user.id)
  const account = profile.data

  return <section className="work-settings">
    <header className="work-settings-header">
      <h1>Настройки</h1>
      <p>Управляйте аккаунтом, безопасностью и рабочими предпочтениями.</p>
    </header>
    {profile.isLoading && <p role="status">Загружаем настройки…</p>}
    {profile.isError && <ErrorState message="Не удалось загрузить настройки." retryLabel="Повторить"
      pending={profile.isFetching} onRetry={profile.refetch} />}
    {account && owner && <div className="work-settings-columns">
      <div className="work-settings-column">
        <SettingsForm title="Профиль" label="Сохранить имя" success="Имя сохранено."
          save={data => update({ name: value(data, 'name') }).unwrap()}>
          <label>Имя<input key={account.name} name="name" defaultValue={account.name} maxLength={100} autoComplete="name" /></label>
          <div className="work-settings-current-email"><span>Текущий email</span><strong>{account.email}</strong></div>
        </SettingsForm>
        <EmailSettings key={owner} owner={owner} email={account.email} />
        <SettingsForm title="Настройки приложения" label="Сохранить предпочтения" success="Предпочтения сохранены."
          save={data => update({ theme: value(data, 'theme') as 'light' | 'dark', reminderDays: Number(value(data, 'days')) as 0 | 1 | 3 | 7 }).unwrap()}>
          <label>Тема<select key={theme} name="theme" defaultValue={theme}><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>
          <label>Напоминать о дедлайнах<select key={account.reminderDays} name="days" defaultValue={account.reminderDays}>
            <option value="0">Выключено</option><option value="1">За 1 день</option><option value="3">За 3 дня</option><option value="7">За 7 дней</option>
          </select></label>
          <p className="work-settings-hint">Просроченные и ближайшие задачи появятся в обзоре при открытом приложении.</p>
        </SettingsForm>
      </div>
      <div className="work-settings-column">
        <section className="work-settings-security" aria-labelledby="settings-security-title">
          <h2 id="settings-security-title">Безопасность</h2>
          <PasswordSettings />
          <SessionSettings />
        </section>
        <ExportSettings />
      </div>
    </div>}
  </section>
}
