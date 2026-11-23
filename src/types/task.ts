export type Task = {
  id: string
  title: string
  completed: boolean
}

export type TaskFilter = 'all' | 'active' | 'completed'
export const taskStatuses = ['backlog', 'todo', 'in-progress', 'done'] as const
export const taskPriorities = ['low', 'medium', 'high', 'urgent'] as const
export const reminderOptions = [
  [0, 'В момент дедлайна'], [15, 'За 15 минут'], [60, 'За 1 час'], [1440, 'За 1 день'],
] as const
export type ReminderMinutes = typeof reminderOptions[number][0]
export const statusLabels = {
  backlog: 'Запланировано', todo: 'К выполнению', 'in-progress': 'В работе', done: 'Готово',
}
export const priorityLabels = { low: 'Низкий', medium: 'Обычный', high: 'Высокий', urgent: 'Срочный' }
export const projectColors = { green: 'Зелёный', blue: 'Синий', purple: 'Фиолетовый', amber: 'Янтарный' }
export const projectIcons = { folder: '▣', flag: '⚑', bolt: 'ϟ', star: '✦' }
export const projectIconLabels = { folder: 'Папка', flag: 'Флаг', bolt: 'Молния', star: 'Звезда' }
export type ProjectDraft = {
  name: string
  description: string
  color: keyof typeof projectColors
  icon: keyof typeof projectIcons
}
export type Project = ProjectDraft & { id: string; archived: boolean; total: number; done: number }
export type Subtask = { id: string; title: string; completed: boolean }
export type HistoryEntry = { id: string; action: 'created' | 'updated' | 'deleted'; fields: string[]; occurredAt: string }
export type TaskStatus = typeof taskStatuses[number]
export type TaskPriority = typeof taskPriorities[number]
export type TaskDetails = {
  description: string
  status: TaskStatus
  priority: TaskPriority
  startsOn: string | null
  dueOn: string | null
  dueTime: string | null
  dueZone: string | null
  reminderMinutes: ReminderMinutes | null
  projectId: string | null
  category: string
  tags: string[]
  subtasks: Subtask[]
}
export type BulkAction = { type: 'status'; status: TaskStatus } |
  { type: 'project'; projectId: string | null } | { type: 'delete' }
export type WorkspaceTask = Task & Partial<TaskDetails> & { remindAt?: number | null }

export function statusOf(task: WorkspaceTask): TaskStatus {
  return task.status ?? (task.completed ? 'done' : 'todo')
}
