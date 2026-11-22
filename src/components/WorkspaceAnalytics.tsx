import { useState } from 'react'
import Link from 'next/link'
import { useAnalyticsQuery } from '../store/api'
import { dateLabel, weeklyActivity } from '../types/planning'
import { priorityLabels, statusLabels } from '../types/task'
import { ErrorState } from './ErrorState'

const periods = [7, 30, 90] as const
const dateFormat = { day: 'numeric', month: 'short' } as const

function Distribution({ title, rows }: { title: string; rows: [string, number][] }) {
  const total = rows.reduce((sum, [, count]) => sum + count, 0)
  return <section className="work-insight"><h2>{title}</h2>
    {rows.map(([name, count]) => <div className="work-distribution" key={name}>
      <span>{name}</span><meter aria-hidden="true" max={total || 1} value={count} /><span>{count}</span>
    </div>)}
  </section>
}

export function WorkspaceAnalytics() {
  const [days, setDays] = useState<(typeof periods)[number]>(30)
  const [weekly, setWeekly] = useState(false)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const { currentData: data, isFetching, isError, refetch } = useAnalyticsQuery({ days, zone })
  const series = data ? (weekly ? weeklyActivity(data.activity) : data.activity) : []
  const max = Math.max(1, ...series.map(day => Math.max(day.created, day.completed)))
  const rate = data?.created ? Math.round(data.createdDone / data.created * 100) : 0

  return <section className="planning-page" aria-label="Аналитика рабочего пространства">
    <div className="work-section-title"><h1>Аналитика</h1>
      <div className="work-views" aria-label="Период">
        {periods.map(period => <button type="button" key={period} aria-pressed={days === period}
          onClick={() => { setDays(period); if (period === 90) setWeekly(true) }}>{period} дней</button>)}
      </div>
    </div>
    {isError ? <ErrorState message="Не удалось загрузить аналитику." retryLabel="Повторить"
      pending={isFetching} onRetry={() => void refetch()} /> : !data ? <p role="status">Загружаем аналитику…</p> : <>
      <dl className="work-stats analytics-stats">
        <div><dt>Создано за период</dt><dd>{data.created}</dd></div>
        <div><dt>Завершено за период</dt><dd>{data.completed}</dd></div>
        <div><dt>Выполнено из созданных за период</dt><dd>{rate}%</dd></div>
        <div><dt>Просрочено сейчас</dt><dd>{data.overdue}</dd></div>
      </dl>
      <section className="work-insight analytics-activity">
        <div className="work-section-title"><h2>Динамика за {days} дней</h2>
          <div className="work-views">
            <button type="button" aria-pressed={!weekly} onClick={() => setWeekly(false)}>По дням</button>
            <button type="button" aria-pressed={weekly} onClick={() => setWeekly(true)}>По неделям</button>
          </div>
        </div>
        <div className="analytics-legend"><span>Создание</span><span>Переходы в «Готово»</span></div>
        <div className="analytics-bars" data-dense={series.length > 35} aria-hidden="true">
          {series.map((point, index) => <div key={point.date} className="analytics-bucket"
            title={`${dateLabel(point.date, dateFormat)}: создано ${point.created}, завершения ${point.completed}`}>
            <div className="analytics-bar-pair">
              <i style={{ height: `${point.created / max * 100}%` }} />
              <i style={{ height: `${point.completed / max * 100}%` }} />
            </div>
            <small>{index % Math.ceil(series.length / 6) === 0 ? dateLabel(point.date, { day: 'numeric', month: 'numeric' }) : ''}</small>
          </div>)}
        </div>
        <details className="analytics-table">
          <summary>Данные графика</summary>
          <table><thead><tr><th>Дата</th><th>Создание</th><th>Завершения</th></tr></thead>
            <tbody>{series.map(point => <tr key={point.date}><th scope="row">{dateLabel(point.date, dateFormat)}</th>
              <td>{point.created}</td><td>{point.completed}</td></tr>)}</tbody>
          </table>
        </details>
      </section>
      <p className="planning-note">Распределения и проекты отражают текущие задачи. История завершений учитывается с момента включения статистики.</p>
      <div className="work-insights">
        <Distribution title="По статусам" rows={Object.entries(statusLabels).map(([key, name]) =>
          [name, data.statuses[key as keyof typeof statusLabels] ?? 0])} />
        <Distribution title="По приоритетам" rows={Object.entries(priorityLabels).map(([key, name]) =>
          [name, data.priorities[key as keyof typeof priorityLabels] ?? 0])} />
      </div>
      <section className="work-insight"><h2>Проекты</h2>
        {data.projects.length ? <ul>{data.projects.map(project => <li key={project.id}>
          <Link href={`/projects/${project.id}`}>{project.name}{project.archived ? ' · архив' : ''}</Link>
          <span>{project.done} из {project.total}</span>
        </li>)}</ul> : <p>Проектов пока нет.</p>}
      </section>
      <section className="work-insight"><h2>Просроченные задачи</h2>
        {data.overdueTasks.length ? <ul>{data.overdueTasks.map(task => <li key={task.id}>
          <span>{task.title}</span><time dateTime={task.dueOn}>{dateLabel(task.dueOn, dateFormat)}</time>
        </li>)}</ul> : <p>Просроченных задач нет.</p>}
      </section>
    </>}
  </section>
}
