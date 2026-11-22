import { useRef, useState } from 'react'
import { priorityLabels, statusLabels, statusOf, taskStatuses } from '../types/task'
import type { TaskStatus, WorkspaceTask } from '../types/task'

export function TaskBoard({ tasks, busy, move, open }: {
  tasks: WorkspaceTask[]
  busy: Set<string>
  move: (id: string, status: TaskStatus) => void
  open: (task: WorkspaceTask) => void
}) {
  const dragging = useRef<WorkspaceTask>(null)
  const [target, setTarget] = useState<TaskStatus | null>(null)

  return (
    <div className="work-board" aria-label="Kanban">
      {taskStatuses.map(status => {
        const column = tasks.filter(task => statusOf(task) === status)
        return (
          <section className="work-column" data-status={status} data-drop-target={target === status} key={status}
            onDragOver={event => {
              if (!dragging.current) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setTarget(status)
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null)
            }}
            onDrop={event => {
              event.preventDefault()
              const task = dragging.current
              dragging.current = null
              setTarget(null)
              if (task && statusOf(task) !== status) move(task.id, status)
            }}>
            <h3>{statusLabels[status]} <span>{column.length}</span></h3>
            {column.length === 0 && <p>Нет задач</p>}
            {column.map(task => (
              <article className="work-board-task" key={task.id} draggable={!busy.has(task.id)}
                onDragStart={event => {
                  dragging.current = task
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', task.id)
                }}
                onDragEnd={() => { dragging.current = null; setTarget(null) }}>
                <button type="button" onClick={() => open(task)}>{task.title}</button>
                <div className="work-task-meta">
                  <span data-priority={task.priority}>{priorityLabels[task.priority ?? 'medium']}</span>
                  {task.dueOn && <time dateTime={task.dueOn}>{task.dueOn}</time>}
                </div>
                {task.category && <small className="work-board-category">{task.category}</small>}
                {!!task.tags?.length && <div className="work-tags">{task.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
                {!!task.subtasks?.length && <small className="work-subtask-count">
                  Подзадачи {task.subtasks.filter(item => item.completed).length}/{task.subtasks.length}
                </small>}
                <select aria-label={`Статус задачи: ${task.title}`} value={status}
                  disabled={busy.has(task.id)} onChange={event => {
                    const next = taskStatuses.find(item => item === event.target.value)
                    if (next) move(task.id, next)
                  }}>
                  {taskStatuses.map(item => <option key={item} value={item}>{statusLabels[item]}</option>)}
                </select>
              </article>
            ))}
          </section>
        )
      })}
    </div>
  )
}
