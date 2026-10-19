import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'

type TaskFormProps = {
  onAdd: (title: string) => Promise<boolean>
  pending: boolean
}

export function TaskForm({ onAdd, pending }: TaskFormProps) {
  const [title, setTitle] = useState('')

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>): void {
    setTitle(event.target.value)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    if (await onAdd(trimmedTitle)) setTitle('')
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <span className="input-plus" aria-hidden="true">＋</span>
      <input
        aria-label="Название новой задачи"
        placeholder="Что нужно сделать?"
        value={title}
        onChange={handleTitleChange}
        maxLength={300}
      />
      <button
        className="add-button"
        disabled={pending || !title.trim()}
        type="submit"
      >
        {pending ? 'Добавляем…' : 'Добавить'} <span aria-hidden="true">↗</span>
      </button>
    </form>
  )
}
