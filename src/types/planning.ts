import type { Project, TaskPriority, TaskStatus } from './task'

export type CalendarView = 'month' | 'week'
export type ActivityDay = { date: string; created: number; completed: number }
export type Analytics = {
  created: number
  completed: number
  createdDone: number
  currentDone: number
  currentTotal: number
  overdue: number
  overdueTasks: { id: string; title: string; dueOn: string }[]
  activity: ActivityDay[]
  statuses: Partial<Record<TaskStatus, number>>
  priorities: Partial<Record<TaskPriority, number>>
  projects: Pick<Project, 'id' | 'name' | 'archived' | 'total' | 'done'>[]
}

export function localDay(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-')
}

function utcDate(day: string) { return new Date(day + 'T00:00:00Z') }
function isoDay(date: Date) { return date.toISOString().slice(0, 10) }

export function addDays(day: string, offset: number) {
  const date = utcDate(day)
  date.setUTCDate(date.getUTCDate() + offset)
  return isoDay(date)
}

export function weekStart(day: string) {
  return addDays(day, -((utcDate(day).getUTCDay() + 6) % 7))
}

export function calendarDays(anchor: string, view: CalendarView) {
  const start = weekStart(view === 'month' ? anchor.slice(0, 7) + '-01' : anchor)
  return Array.from({ length: view === 'month' ? 42 : 7 }, (_, index) => addDays(start, index))
}

export function shiftCalendar(anchor: string, view: CalendarView, direction: -1 | 1) {
  if (view === 'week') return addDays(anchor, direction * 7)
  const month = utcDate(anchor.slice(0, 7) + '-01')
  month.setUTCMonth(month.getUTCMonth() + direction)
  return isoDay(month)
}

export function dateLabel(day: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(utcDate(day))
}

export function weeklyActivity(days: ActivityDay[]) {
  const weeks = new Map<string, ActivityDay>()
  for (const day of days) {
    const date = weekStart(day.date)
    const week = weeks.get(date) ?? { date, created: 0, completed: 0 }
    week.created += day.created
    week.completed += day.completed
    weeks.set(date, week)
  }
  return [...weeks.values()]
}
