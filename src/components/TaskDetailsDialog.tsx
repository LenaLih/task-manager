'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { priorityLabels, reminderOptions, statusLabels, statusOf, taskPriorities, taskStatuses } from '../types/task'
import type { TaskDetails, WorkspaceTask } from '../types/task'
import { useDeleteTaskMutation, useProjectsQuery, useTaskHistoryQuery } from '../store/api'
import { requestMessage } from '../store/requestMessage'
import { TaskReminderSelect } from './TaskReminderSelect'

export type TaskDraft = TaskDetails & { title: string }

const historyLabels = { created: 'Создание', updated: 'Изменение', deleted: 'Удаление' }
const fieldLabels: Record<string, string> = {
  title: 'Название', description: 'Описание', status: 'Статус', priority: 'Приоритет',
  starts_on: 'Дата начала', due_on: 'Дедлайн', project_id: 'Проект',
  due_time: 'Время дедлайна', due_zone: 'Часовой пояс', reminder_minutes: 'Напоминание',
  category: 'Категория', tags: 'Теги', subtasks: 'Подзадачи',
}

export function TaskDetailsDialog({ task, projectId, close, save }: {
  task?: WorkspaceTask
  projectId?: string
  close: () => void
  save: (draft: TaskDraft) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  const subtasksPanel = useRef<HTMLDetailsElement>(null)
  const sending = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteTask] = useDeleteTaskMutation()
  const [subtasks, setSubtasks] = useState(task?.subtasks ?? [])
  const [dueOn, setDueOn] = useState(task?.dueOn ?? '')
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '')
  const [historyOpen, setHistoryOpen] = useState(false)
  const projects = useProjectsQuery()
  const history = useTaskHistoryQuery(task?.id ?? '', { skip: !historyOpen || !task })
  const selectedProject = task ? task.projectId : projectId
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  useEffect(() => {
    if (confirming) cancelDeleteButton.current?.focus()
  }, [confirming])

  function cancelDelete() {
    setConfirming(false)
    requestAnimationFrame(() => deleteButton.current?.focus({ preventScroll: true }))
  }

  async function remove() {
    if (!task || !confirming || sending.current) return
    sending.current = true
    setPending(true)
    setDeleteError('')
    try {
      await deleteTask(task.id).unwrap()
      close()
    } catch {
      setDeleteError('Не удалось удалить задачу. Повторите попытку.')
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current || confirming) return
    const values = new FormData(event.currentTarget)
    const title = String(values.get('title')).trim()
    const status = taskStatuses.find(item => item === values.get('status'))
    const priority = taskPriorities.find(item => item === values.get('priority'))
    const startsOn = String(values.get('startsOn')) || null
    const date = dueOn || null
    const time = date && dueTime ? dueTime : null
    const zone = time ? task?.dueZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : null
    const reminderMinutes = time
      ? reminderOptions.find(([minutes]) => String(minutes) === values.get('reminderMinutes'))?.[0] ?? null
      : null
    if (!title || !status || !priority) {
      setError('Укажите название, статус и приоритет.')
      return
    }
    if (startsOn && date && startsOn > date) {
      setError('Срок должен быть не раньше даты начала.')
      return
    }
    const tags = [...new Set(String(values.get('tags')).split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))]
    const projectId = values.get('projectId')
    const category = String(values.get('category')).trim()
    const items = subtasks.map(item => ({ ...item, title: item.title.trim() }))
    if (tags.length > 12 || tags.some(tag => tag.length > 32) || items.some(item => !item.title)) {
      setError('Заполните названия подзадач. Можно добавить до 12 тегов по 32 символа.')
      return
    }
    sending.current = true
    setPending(true)
    setError('')
    try {
      await save({ title, status, priority, startsOn, dueOn: date, dueTime: time, dueZone: zone, reminderMinutes,
        description: String(values.get('description')).trim(),
        projectId: typeof projectId === 'string' ? projectId || null : selectedProject ?? null,
        category, tags, subtasks: items })
      close()
    } catch (failure) {
      setError(requestMessage(failure, 'Не удалось сохранить задачу. Повторите попытку.'))
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  return (
    <dialog ref={dialog} className={`work-dialog task-editor${confirming ? ' task-editor-confirming' : ''}`}
      role={confirming ? 'alertdialog' : undefined}
      aria-labelledby={confirming ? 'task-delete-title' : 'task-details-title'}
      aria-describedby={confirming ? 'task-delete-description' : undefined}
      aria-busy={pending}
      onCancel={event => {
        event.preventDefault()
        if (sending.current) return
        if (confirming) cancelDelete()
        else close()
      }}>
      <form className="task-editor-form" onSubmit={submit} hidden={confirming}>
        <h2 id="task-details-title">{task ? 'Свойства задачи' : 'Новая задача'}</h2>
        <div className="task-editor-fields">
          <label>Название<input name="title" defaultValue={task?.title} required maxLength={300} /></label>
          <label>Описание<textarea name="description" defaultValue={task?.description} maxLength={3000} rows={2} /></label>
          <div className="work-field-pair">
            <label>Статус<select name="status" defaultValue={task ? statusOf(task) : 'todo'}>
              {taskStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select></label>
            <label>Приоритет<select name="priority" defaultValue={task?.priority ?? 'medium'}>
              {taskPriorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
            </select></label>
          </div>
          <div className="work-field-pair">
            <label>Проект<select name="projectId" key={projects.isSuccess ? 'ready' : 'loading'}
              defaultValue={selectedProject ?? ''} disabled={!projects.isSuccess}>
              <option value="">Без проекта</option>
              {projects.data?.filter(project => !project.archived || project.id === selectedProject).map(project =>
                <option value={project.id} key={project.id}>{project.name}{project.archived ? ' · архив' : ''}</option>)}
            </select></label>
            <label>Категория<input name="category" maxLength={60} defaultValue={task?.category} /></label>
          </div>
          {projects.isError && <p role="status">Список проектов недоступен.</p>}
          <div className="work-field-pair">
            <label>Дата начала<input name="startsOn" type="date" defaultValue={task?.startsOn ?? ''} /></label>
            <label>Дедлайн<input name="dueOn" type="date" value={dueOn} onChange={event => setDueOn(event.target.value)} /></label>
          </div>
          <div className="work-field-pair">
            <label>Время дедлайна<input type="time" value={dueTime} disabled={!dueOn}
              onChange={event => setDueTime(event.target.value)} /></label>
            <TaskReminderSelect disabled={!dueOn || !dueTime} defaultValue={task?.reminderMinutes ?? undefined} />
          </div>
          {dueOn && dueTime && <small>Часовой пояс: {task?.dueZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</small>}
          <label>Теги через запятую<input name="tags" maxLength={402} defaultValue={task?.tags?.join(', ')} /></label>
          <details ref={subtasksPanel} className="task-editor-section">
            <summary>Подзадачи · {subtasks.filter(item => item.completed).length}/{subtasks.length}</summary>
            <fieldset className="task-subtasks" aria-label="Подзадачи" onInvalidCapture={() => {
              if (subtasksPanel.current) subtasksPanel.current.open = true
            }}>
              {subtasks.map((item, index) => (
                <div key={item.id} className="task-subtask">
                  <input type="checkbox" aria-label={`Подзадача ${index + 1} выполнена`} checked={item.completed}
                    onChange={event => {
                      const completed = event.currentTarget.checked
                      setSubtasks(old => old.map(row => row.id === item.id ? { ...row, completed } : row))
                    }} />
                  <input aria-label={`Подзадача ${index + 1}`} required maxLength={120} value={item.title}
                    onChange={event => {
                      const title = event.currentTarget.value
                      setSubtasks(old => old.map(row => row.id === item.id ? { ...row, title } : row))
                    }} />
                  <button type="button" aria-label={`Удалить подзадачу ${index + 1}`}
                    onClick={() => setSubtasks(old => old.filter(row => row.id !== item.id))}>×</button>
                </div>
              ))}
              <button type="button" disabled={subtasks.length >= 20}
                onClick={() => setSubtasks(old => [...old, { id: crypto.randomUUID(), title: '', completed: false }])}>
                Добавить подзадачу
              </button>
            </fieldset>
          </details>
          {task && <details className="task-editor-section" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
            <summary>История задачи</summary>
            {history.isFetching ? <p role="status">Загружаем историю…</p> : history.isError ?
              <p role="alert">Не удалось загрузить историю.</p> :
              history.data?.length ? <ol className="task-history">
                {history.data.map(entry => <li key={entry.id}>
                  <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString('ru-RU')}</time>
                  {' · '}{historyLabels[entry.action]}
                  {entry.fields.length > 0 && `: ${entry.fields.map(field => fieldLabels[field] ?? field).join(', ')}`}
                </li>)}
              </ol> : <p>Изменений пока нет.</p>}
          </details>}
        </div>
        <div className="task-editor-footer">
          {error && <p role="alert" className="work-error">{error}</p>}
          <div className="work-dialog-actions task-editor-actions">
            {task && <button ref={deleteButton} type="button" className="task-delete-button" disabled={pending} onClick={() => {
              if (sending.current) return
              setDeleteError('')
              setConfirming(true)
            }}>Удалить</button>}
            <button type="button" onClick={close} disabled={pending}>Отмена</button>
            <button className="add-button" type="submit" disabled={pending}>
              {pending ? 'Сохраняем…' : 'Сохранить задачу'}
            </button>
          </div>
        </div>
      </form>
      {task && confirming && <section className="task-delete-confirmation">
        <h2 id="task-delete-title">Удалить задачу?</h2>
        <div id="task-delete-description">
          <p className="task-delete-name">«{task.title}»</p>
          <p>Это действие нельзя отменить.</p>
        </div>
        {deleteError && <p className="work-error" role="alert">{deleteError}</p>}
        <div className="work-dialog-actions task-editor-actions">
          <button ref={cancelDeleteButton} type="button" disabled={pending} onClick={cancelDelete}>Отмена</button>
          <button type="button" className="task-delete-button" disabled={pending} onClick={() => void remove()}>
            {pending ? 'Удаляем…' : 'Удалить задачу'}
          </button>
        </div>
      </section>}
    </dialog>
  )
}
