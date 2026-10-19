import type { Task, TaskFilter } from '../types/task'
import { TaskItem } from './TaskItem'

type TaskListProps = {
  busy: Set<Task['id']>
  tasks: Task[]
  filter: TaskFilter
  onToggle: (id: Task['id']) => void
  onDelete: (id: Task['id']) => void
  onEdit: (id: Task['id'], title: Task['title']) => void
}

type EmptyMessage = {
  title: string
  description: string
}

const EMPTY_MESSAGES: Record<TaskFilter, EmptyMessage> = {
  all: {
    title: 'Начните с маленького шага',
    description: 'Добавьте первую задачу и освободите место для мыслей.',
  },
  active: {
    title: 'Можно выдохнуть',
    description: 'Активных задач нет. Время для новых планов.',
  },
  completed: {
    title: 'Всё ещё впереди',
    description: 'Выполненные задачи появятся здесь.',
  },
}

export function TaskList({
  busy,
  tasks,
  filter,
  onToggle,
  onDelete,
  onEdit,
}: TaskListProps) {
  if (!tasks.length) {
    const message = EMPTY_MESSAGES[filter]

    return (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">✓</span>
        <h3>{message.title}</h3>
        <p>{message.description}</p>
      </div>
    )
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          pending={busy.has(task.id)}
          onToggle={onToggle}
          onDelete={onDelete}
          onEdit={onEdit}
        />
      ))}
    </ul>
  )
}
