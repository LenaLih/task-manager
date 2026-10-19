import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import type { Task } from '../types/task'

type TaskItemProps = {
  pending: boolean
  task: Task
  onToggle: (id: Task['id']) => void
  onDelete: (id: Task['id']) => void
  onEdit: (id: Task['id'], title: Task['title']) => void
}

export function TaskItem({
  task,
  pending,
  onToggle,
  onDelete,
  onEdit,
}: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(task.title)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [isEditing])

  function handleStartEditing(): void {
    if (pending) return
    setDraftTitle(task.title)
    setIsEditing(true)
  }

  function handleCancelEditing(): void {
    setIsEditing(false)
  }

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>): void {
    event.currentTarget.setCustomValidity('')
    setDraftTitle(event.currentTarget.value)
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return

    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEditing()
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const title = draftTitle.trim()

      if (!title) {
        event.currentTarget.setCustomValidity('Название задачи не может быть пустым.')
        event.currentTarget.reportValidity()
        return
      }

      onEdit(task.id, title)
      setIsEditing(false)
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLSpanElement>): void {
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      handleStartEditing()
    }
  }

  function handleToggle(): void {
    onToggle(task.id)
  }

  function handleDelete(): void {
    onDelete(task.id)
  }

  return (
    <li className={`task-item ${task.completed ? 'completed' : ''}`}>
      <div className="task-label">
        <input
          disabled={pending}
          type="checkbox"
          aria-label={`Отметить задачу: ${task.title}`}
          checked={task.completed}
          onChange={handleToggle}
        />
        {isEditing ? (
          <input
            ref={editInputRef}
            className="task-edit-input"
            type="text"
            aria-label="Редактировать название задачи"
            value={draftTitle}
            onChange={handleDraftChange}
            onKeyDown={handleEditKeyDown}
            onBlur={handleCancelEditing}
            maxLength={300}
            required
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            title="Двойной клик или Enter для редактирования"
            onDoubleClick={handleStartEditing}
            onKeyDown={handleTitleKeyDown}
          >
            {task.title}
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        className="delete-button"
        aria-label={`Удалить задачу: ${task.title}`}
        onClick={handleDelete}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
        </svg>
      </button>
    </li>
  )
}
