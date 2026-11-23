import { useRef, useState } from 'react'
import { useProjectsQuery } from '../store/api'
import { calendarDays, dateLabel, localDay, shiftCalendar } from '../types/planning'
import type { CalendarView } from '../types/planning'
import { priorityLabels, statusLabels, statusOf, taskStatuses } from '../types/task'
import type { WorkspaceTask } from '../types/task'

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const longDate = { day: 'numeric', month: 'long', year: 'numeric' } as const
const shortDate = { day: 'numeric', month: 'short' } as const

export function TaskCalendar({ tasks, busy, open, move }: {
  tasks: WorkspaceTask[]
  busy: Set<string>
  open: (task: WorkspaceTask) => void
  move: (task: WorkspaceTask, date: string) => void
}) {
  const today = localDay()
  const [anchor, setAnchor] = useState(today)
  const [view, setView] = useState<CalendarView>('month')
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState('')
  const [target, setTarget] = useState('')
  const dragging = useRef<WorkspaceTask | null>(null)
  const projects = useProjectsQuery()
  const days = calendarDays(anchor, view)
  const grouped = new Map<string, WorkspaceTask[]>()
  for (const task of tasks) {
    if (!task.dueOn || (projectId && task.projectId !== projectId) || (status && statusOf(task) !== status)) continue
    const list = grouped.get(task.dueOn) ?? []
    list.push(task)
    grouped.set(task.dueOn, list)
  }
  const title = view === 'month' ? dateLabel(anchor, { month: 'long', year: 'numeric' }) :
    `${dateLabel(days[0], shortDate)} — ${dateLabel(days[6], longDate)}`

  function taskButton(task: WorkspaceTask, drag = false) {
    const taskStatus = statusOf(task)
    const priority = task.priority ?? 'medium'
    return <button type="button" className="calendar-task" key={task.id}
      data-priority={priority} data-status={taskStatus} draggable={drag && !busy.has(task.id)}
      disabled={busy.has(task.id)} onClick={() => open(task)}
      onDragStart={event => {
        dragging.current = task
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
      }}
      onDragEnd={() => { dragging.current = null; setTarget('') }}>
      <strong>{task.title}</strong>
      <small>{task.dueTime && `${task.dueTime} · `}{priorityLabels[priority]} · {statusLabels[taskStatus]}</small>
    </button>
  }

  return <section className="planning-page" aria-label="Календарь задач">
    <div className="work-section-title"><h1>Календарь</h1>
      <div className="work-views">
        <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>Месяц</button>
        <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Неделя</button>
      </div>
    </div>
    <div className="planning-controls">
      <div className="work-views calendar-navigation">
        <button type="button" aria-label="Предыдущий период" onClick={() => setAnchor(shiftCalendar(anchor, view, -1))}>‹</button>
        <button type="button" onClick={() => setAnchor(today)}>Сегодня</button>
        <button type="button" aria-label="Следующий период" onClick={() => setAnchor(shiftCalendar(anchor, view, 1))}>›</button>
      </div>
      <label>Проект<select value={projectId} onChange={event => setProjectId(event.target.value)}>
        <option value="">Все проекты</option>
        {projects.data?.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      <label>Статус<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">Все статусы</option>
        {taskStatuses.map(item => <option key={item} value={item}>{statusLabels[item]}</option>)}
      </select></label>
    </div>
    {projects.isError && <p role="status">Не удалось загрузить список проектов.</p>}
    <h2 className="calendar-period" aria-live="polite">{title}</h2>
    <div className="calendar-grid">
      {weekdays.map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
      {days.map(day => {
        const dated = grouped.get(day) ?? []
        return <div className="calendar-day" key={day} data-day={day}
          data-outside={view === 'month' && day.slice(0, 7) !== anchor.slice(0, 7)}
          data-target={target === day}
          onDragOver={event => {
            if (!dragging.current) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setTarget(day)
          }}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget('')
          }}
          onDrop={event => {
            event.preventDefault()
            const task = dragging.current
            dragging.current = null
            setTarget('')
            if (task && task.dueOn !== day) move(task, day)
          }}>
          <button type="button" className="calendar-date" aria-pressed={anchor === day}
            aria-label={`${dateLabel(day, longDate)}, задач: ${dated.length}`}
            aria-current={day === today ? 'date' : undefined}
            onClick={() => setAnchor(day)}>
            {Number(day.slice(8))}
            {!!dated.length && <small>{dated.length}</small>}
          </button>
          <div className="calendar-cell-tasks">{dated.map(task => taskButton(task, true))}</div>
        </div>
      })}
    </div>
    <section className="calendar-selected" aria-label="Задачи выбранного дня">
      <h3>{dateLabel(anchor, longDate)}</h3>
      {(grouped.get(anchor) ?? []).map(task => taskButton(task))}
      {!grouped.get(anchor)?.length && <p>На этот день нет задач.</p>}
    </section>
  </section>
}
