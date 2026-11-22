import { addDays } from './planning'
import type { Project, TaskFilter, WorkspaceTask } from './task'

export type Profile = { name: string; email: string; theme: 'light' | 'dark' | null; reminderDays: 0 | 1 | 3 | 7 }
export type ActiveSession = { id: string; device: string; createdAt: string; expires: number; current: boolean }
export type SavedFilter = {
  name: string
  filters: { filter: TaskFilter; status: string; priority: string; tag: string; category: string; sort: string; search: string }
}

export function searchWorkspace(tasks: WorkspaceTask[], projects: Project[], query: string) {
  const text = query.trim().toLocaleLowerCase()
  if (!text) return { tasks: [], projects: [], tags: [] }
  const matches = (value: string) => value.toLocaleLowerCase().includes(text)
  return {
    tasks: tasks.filter(task => matches(task.title) || matches(task.description ?? '') ||
      task.tags?.some(matches)).slice(0, 12),
    projects: projects.filter(project => matches(project.name) || matches(project.description)).slice(0, 8),
    tags: [...new Set(tasks.flatMap(task => task.tags ?? []).filter(matches))].sort().slice(0, 8),
  }
}

export function upcomingTasks(tasks: WorkspaceTask[], today: string, days: number) {
  if (!days) return []
  const through = addDays(today, days)
  return tasks.filter(task => !task.completed && task.dueOn && task.dueOn <= through)
    .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
}
