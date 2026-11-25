'use client'

import { useEffect, useState } from 'react'
import { taskApi } from '../store/api'
import type { AdminOverview, AdminSort, AdminUser } from '../types/admin'
import { ErrorState } from './ErrorState'

const number = new Intl.NumberFormat('ru')
const date = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
const chartDate = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const metrics: [Exclude<keyof AdminOverview, 'trackingSince' | 'registrations'>, string][] = [
  ['users', 'Пользователи'], ['registeredToday', 'Регистрации сегодня'],
  ['registered7', 'Регистрации за 7 дней'], ['registered30', 'Регистрации за 30 дней'],
  ['active7', 'Активные за 7 дней'], ['active30', 'Активные за 30 дней'],
  ['tasks', 'Задачи'], ['completed', 'Выполненные задачи'], ['projects', 'Проекты'],
]
const columns: [AdminSort, string][] = [
  ['name', 'Имя'], ['email', 'Email'], ['registeredAt', 'Регистрация'], ['lastActiveAt', 'Активность'],
  ['tasks', 'Задачи'], ['completed', 'Выполнено'], ['projects', 'Проекты'], ['role', 'Роль'],
]

function display(user: AdminUser, field: AdminSort) {
  if (field === 'registeredAt') {
    if (user.registeredAt) return date.format(new Date(user.registeredAt))
    if (user.registrationKnownBy) return 'Существовал не позднее ' + date.format(new Date(user.registrationKnownBy))
    return 'Неизвестна'
  }
  if (field === 'lastActiveAt') return user.lastActiveAt ? date.format(new Date(user.lastActiveAt)) : '—'
  if (field === 'role') return user.role === 'admin' ? 'Администратор' : 'Пользователь'
  return user[field] === '' ? '—' : user[field]
}

export default function AdminDashboard() {
  const [days, setDays] = useState<30 | 90>(30)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<AdminSort>('registeredAt')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(input.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [input])
  const overview = taskApi.useAdminOverviewQuery(days, { refetchOnMountOrArgChange: true })
  const users = taskApi.useAdminUsersQuery({ page, search, sort, direction }, { refetchOnMountOrArgChange: true })
  const stats = overview.currentData
  const list = users.currentData
  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / 20))
  const max = Math.max(1, ...(stats?.registrations.map(point => point.count ?? 0) ?? []))
  const denied = [overview.error, users.error].some(error => error && 'status' in error && error.status === 403)
  if (denied) return <p role="alert">Доступ разрешён только администраторам.</p>

  return <div className="admin-dashboard">
    <header className="work-section-title"><h1>Администрирование</h1></header>
    {overview.isError ? <ErrorState message="Не удалось загрузить статистику." retryLabel="Повторить"
      pending={overview.isFetching} onRetry={overview.refetch} /> : stats ? <>
      <dl className="work-stats admin-metrics">{metrics.map(([field, label]) =>
        <div key={field}><dt>{label}</dt><dd>{number.format(stats[field])}</dd></div>)}</dl>
      <p className="admin-note">Регистрации и активность учитываются с {date.format(new Date(stats.trackingSince))} UTC.
        Даты регистрации более ранних аккаунтов неизвестны. День регистрации определяется по UTC.</p>
    </> : <p role="status">Загружаем статистику…</p>}
    <section className="admin-panel" aria-labelledby="admin-chart-title">
      <div className="admin-toolbar"><h2 id="admin-chart-title">Новые регистрации</h2>
        <label>Период <select value={days} onChange={event => setDays(event.target.value === '90' ? 90 : 30)}>
          <option value={30}>30 дней</option><option value={90}>90 дней</option>
        </select></label>
      </div>
      {stats && !overview.isError && (stats.registrations.some(point => point.count) ? <>
        <div className="admin-bars" aria-hidden="true">{stats.registrations.map(point =>
          <div key={point.day} title={`${point.day} · ${point.count ?? 'нет данных'}`}
            style={{ height: `${(point.count ?? 0) / max * 100}%` }} />)}</div>
        <div className="admin-axis"><span>{chartDate.format(new Date(stats.registrations[0].day))}</span>
          <span>{chartDate.format(new Date(stats.registrations.at(-1)!.day))}</span></div>
        <details><summary>Данные по дням</summary>
          <ul className="admin-chart-data">{stats.registrations.map(point =>
            <li key={point.day}>{chartDate.format(new Date(point.day))} · {point.count === null ? 'нет данных' : number.format(point.count)}</li>)}</ul>
        </details>
      </> : <p>За выбранный период нет зафиксированных регистраций.</p>)}
    </section>
    <section className="admin-panel" aria-labelledby="admin-users-title">
      <div className="admin-toolbar"><h2 id="admin-users-title">Пользователи</h2>
        <label>Поиск <input type="search" maxLength={254} value={input} placeholder="Имя или email"
          onChange={event => setInput(event.target.value)} /></label>
      </div>
      {users.isError ? <ErrorState message="Не удалось загрузить пользователей." retryLabel="Повторить"
        pending={users.isFetching} onRetry={users.refetch} /> : !list ? <p role="status">Загружаем пользователей…</p> : <>
        <p className="admin-note">Найдено · {number.format(list.total)}. Даты указаны в UTC.</p>
        {list.users.length ? <>
        <p className="admin-note admin-scroll-hint">Прокрутите таблицу вправо, чтобы увидеть все столбцы.</p>
        <div className="admin-table-scroll" role="region" aria-label="Таблица пользователей" tabIndex={0}>
          <table className="admin-table"><thead><tr>{columns.map(([field, label]) =>
            <th key={field} scope="col" aria-sort={sort === field ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
              <button type="button" onClick={() => {
                setDirection(sort === field && direction === 'asc' ? 'desc' : 'asc')
                setSort(field)
                setPage(1)
              }}>{label} {sort === field && <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span>}</button>
            </th>)}</tr></thead>
            <tbody>{list.users.map(user => <tr key={user.email}>{columns.map(([field]) =>
              <td key={field}>{display(user, field)}</td>)}</tr>)}</tbody>
          </table>
        </div></> : <p>Пользователи не найдены.</p>}
        {(pages > 1 || page > 1) && <div className="admin-pagination">
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button>
          <span>{page} / {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Далее</button>
        </div>}
      </>}
    </section>
  </div>
}
