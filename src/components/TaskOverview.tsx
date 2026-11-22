import Link from 'next/link'
import { taskApi, useProjectsQuery } from '../store/api'
import { currencyBalances, financeBalances, money } from '../types/finance'
import { addDays, dateLabel } from '../types/planning'
import { statusLabels, statusOf, taskStatuses } from '../types/task'
import type { WorkspaceTask } from '../types/task'
import { ErrorState } from './ErrorState'
import { TaskForm } from './TaskForm'

type Props = {
  tasks: WorkspaceTask[]
  today: string
  name?: string
  reminders: WorkspaceTask[]
  loading: boolean
  failed: boolean
  retrying: boolean
  retry: () => void
  open: (task: WorkspaceTask) => void
  toggle: (id: string) => void
  busy: ReadonlySet<string>
  add: (title: string) => Promise<boolean>
  adding: boolean
  error: string
}

function daySchedule(tasks: WorkspaceTask[], today: string) {
  const end = addDays(today, 7)
  const current: WorkspaceTask[] = []
  const overdue: { task: WorkspaceTask; day: string }[] = []
  const upcoming: typeof overdue = []
  for (const task of tasks) {
    if (!task.completed && task.dueOn && task.dueOn < today) {
      overdue.push({ task, day: task.dueOn })
    } else if (task.startsOn === today || task.dueOn === today) {
      current.push(task)
    } else if (!task.completed) {
      const day = [task.startsOn, task.dueOn].filter((date): date is string =>
        Boolean(date && date > today && date <= end)).sort()[0]
      if (day) upcoming.push({ task, day })
    }
  }
  overdue.sort((a, b) => a.day.localeCompare(b.day))
  upcoming.sort((a, b) => a.day.localeCompare(b.day))
  return { current, overdue, upcoming }
}

const shortDate = { day: 'numeric', month: 'short' } as const

function DatedTasks({ items, open }: {
  items: ReturnType<typeof daySchedule>['upcoming']
  open: Props['open']
}) {
  return <ul className="my-day-rows">{items.map(({ task, day }) => <li key={task.id}>
    <button type="button" aria-label={`Открыть задачу: ${task.title}`} onClick={() => open(task)}>{task.title}</button>
    <time dateTime={day}>{dateLabel(day, shortDate)}</time>
  </li>)}</ul>
}

function DayProjects() {
  const projects = useProjectsQuery()
  const active = projects.data?.filter(project => !project.archived).slice(0, 5) ?? []
  return <section className="my-day-card" aria-labelledby="my-day-projects">
    <header><h2 id="my-day-projects">Мои проекты</h2><Link href="/projects">Все проекты</Link></header>
    {projects.isError
      ? <ErrorState message="Не удалось загрузить проекты." retryLabel="Повторить загрузку проектов" pending={projects.isFetching} onRetry={() => void projects.refetch()} />
      : projects.isLoading ? <p>Загружаем проекты…</p>
      : active.length ? <ul className="my-day-rows">{active.map(project => <li key={project.id}>
        <Link href={`/projects/${project.id}`}>{project.name}</Link>
        <meter aria-label={`Прогресс проекта «${project.name}»`} max={project.total || 1} value={project.done} />
        <span>{project.done} из {project.total}</span>
      </li>)}</ul> : <p>Активных проектов пока нет.</p>}
  </section>
}

function DayFinance() {
  const finance = taskApi.useFinanceQuery()
  const snapshot = finance.data
  const totals = snapshot?.accounts.length
    ? currencyBalances(snapshot.accounts, financeBalances(snapshot)).filter(({ code }) =>
      snapshot.accounts.some(account => account.currency === code))
    : []
  return <section className="my-day-card" aria-labelledby="my-day-finance">
    <header><h2 id="my-day-finance">Финансы</h2><Link href="/finance">К финансам</Link></header>
    {finance.isError
      ? <ErrorState message="Не удалось загрузить остатки." retryLabel="Повторить загрузку финансов" pending={finance.isFetching} onRetry={() => void finance.refetch()} />
      : finance.isLoading ? <p>Загружаем остатки…</p>
      : totals.length ? <dl className="my-day-balances">{totals.map(({ code, total }) => <div key={code}>
        <dt>{code}</dt><dd>{money(total, code)}</dd>
      </div>)}</dl> : <p>Добавьте счёт в разделе «Финансы», чтобы видеть здесь остаток.</p>}
  </section>
}

export function TaskOverview({ tasks, today, name, reminders, loading, failed, retrying, retry, open, toggle, busy, add, adding, error }: Props) {
  const { current, overdue, upcoming } = daySchedule(tasks, today)
  const done = current.filter(task => task.completed).length
  const totalDone = tasks.filter(task => task.completed).length
  return <section className="my-day" id="overview" aria-labelledby="overview-title">
    <div className="my-day-heading">
      <time dateTime={today}>{dateLabel(today, { weekday: 'long', day: 'numeric', month: 'long' })}</time>
      <h1 id="overview-title">Мой день</h1>
      <p>{name?.trim() ? `Здравствуйте, ${name.trim()}!` : 'Здравствуйте!'}</p>
    </div>
    <div className="my-day-grid">
      <section className="my-day-card my-day-today" aria-labelledby="my-day-today">
        <header><h2 id="my-day-today">Сегодня</h2><Link href="/tasks">Все задачи</Link></header>
        {loading ? <p role="status">Загружаем задачи…</p> : failed || retrying
          ? <ErrorState message={retrying ? 'Загружаем задачи…' : 'Не удалось загрузить задачи.'} retryLabel="Повторить" pending={retrying} onRetry={retry} />
          : <>
            <div className="my-day-progress">
              <meter aria-label="Выполнение задач на сегодня" max={current.length || 1} value={done} />
              <span aria-live="polite">Выполнено {done} из {current.length}</span>
            </div>
            <TaskForm onAdd={add} pending={adding} />
            {current.length ? <ul className="my-day-rows">{current.map(task => <li key={task.id}>
              <input type="checkbox" aria-label={`Выполнена задача: ${task.title}`} checked={task.completed}
                disabled={busy.has(task.id)} onChange={() => toggle(task.id)} />
              <button type="button" aria-label={`Открыть задачу: ${task.title}`} data-completed={task.completed}
                onClick={() => open(task)}>{task.title}</button>
            </li>)}</ul> : <p>На сегодня задач пока нет.</p>}
          </>}
        {error && <p className="storage-error" role="alert">{error}</p>}
      </section>
      <section className="my-day-card" aria-labelledby="my-day-upcoming">
        <header><h2 id="my-day-upcoming">Ближайшие дела</h2><Link href="/calendar">Календарь</Link></header>
        {loading || retrying ? <p>Загружаем расписание…</p> : failed ? <p>Расписание временно недоступно.</p> : <>
          {overdue.length > 0 && <div className="my-day-overdue"><h3>Просрочено</h3><DatedTasks items={overdue} open={open} /></div>}
          <h3>Следующие 7 дней</h3>
          {upcoming.length ? <DatedTasks items={upcoming} open={open} /> : <p>На ближайшую неделю задач нет.</p>}
        </>}
      </section>
      <DayProjects />
      <DayFinance />
    </div>
    {!loading && !failed && !retrying && reminders.length > 0 && <details className="my-day-stats">
      <summary><h2 className="my-day-disclosure-title">Напоминания о дедлайнах</h2> ({reminders.length})</summary>
      <DatedTasks items={reminders.slice(0, 5).flatMap(task => task.dueOn ? [{ task, day: task.dueOn }] : [])} open={open} />
      {reminders.length > 5 && <Link href="/calendar">Все дедлайны в календаре</Link>}
    </details>}
    {!loading && !failed && !retrying && <details className="my-day-stats">
      <summary>Статистика задач</summary>
      <dl className="work-stats">
        <div><dt>В работе</dt><dd>{tasks.length - totalDone}</dd></div>
        <div><dt>Завершено</dt><dd>{totalDone} <small>{tasks.length ? Math.round(totalDone / tasks.length * 100) : 0}%</small></dd></div>
        <div><dt>Просрочено</dt><dd>{overdue.length}</dd></div>
      </dl>
      {taskStatuses.map(status => {
        const count = tasks.filter(task => statusOf(task) === status).length
        return <div className="work-distribution" key={status}>
          <span>{statusLabels[status]}</span>
          <meter aria-hidden="true" max={tasks.length || 1} value={count} />
          <span>{count}</span>
        </div>
      })}
    </details>}
  </section>
}
