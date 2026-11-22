'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjectsQuery, useTasksQuery, useUpdateTaskMutation } from '../store/api'
import { searchWorkspace } from '../types/workspace'

const routes = [
  ['Обзор', '/'], ['Мои задачи', '/tasks'], ['Проекты', '/projects'],
  ['Календарь', '/calendar'], ['Аналитика', '/analytics'], ['Финансы', '/finance'], ['Настройки', '/settings'],
]

export function CommandPalette({ close, create }: { close: () => void; create: () => void }) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [feedback, setFeedback] = useState('')
  const tasks = useTasksQuery()
  const projects = useProjectsQuery()
  const [update, state] = useUpdateTaskMutation()
  const results = searchWorkspace(tasks.data ?? [], projects.data ?? [], query)
  const foundTasks = tag ? (tasks.data ?? []).filter(task => task.tags?.includes(tag)).slice(0, 12) : results.tasks
  const navigate = (path: string) => { close(); router.push(path) }

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    input.current?.focus()
    return () => element?.close()
  }, [])

  return <dialog ref={dialog} className="work-dialog work-palette" aria-labelledby="palette-title"
    onCancel={event => { event.preventDefault(); close() }}
    onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('.work-palette-results button:enabled') ?? [])
      if (!buttons.length) return
      event.preventDefault()
      const index = buttons.findIndex(button => button === document.activeElement)
      const offset = event.key === 'ArrowDown' ? 1 : -1
      buttons[index === -1 && offset === -1 ? buttons.length - 1 : (index + offset + buttons.length) % buttons.length]?.focus()
    }}>
    <header className="panel-heading">
      <h2 id="palette-title">Поиск и действия</h2>
      <button type="button" aria-label="Закрыть поиск" onClick={close}>Закрыть</button>
    </header>
    <input ref={input} type="search" aria-label="Глобальный поиск" placeholder="Задачи, проекты, теги…"
      value={query} maxLength={300} onChange={event => { setQuery(event.target.value); setTag(''); setFeedback('') }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          dialog.current?.querySelector<HTMLButtonElement>('.work-palette-results button:enabled')?.click()
        }
      }} />
    {feedback && <p role={state.isError ? 'alert' : 'status'}>{feedback}</p>}
    {query.trim() && (tasks.isFetching || projects.isFetching) && <p role="status">Ищем…</p>}
    {(tasks.isError || projects.isError) && <p role="alert">Не удалось загрузить часть результатов.{' '}
      <button type="button" onClick={() => { void tasks.refetch(); void projects.refetch() }}>Повторить</button></p>}
    <div className="work-palette-results">
      {foundTasks.map(task => <div className="work-palette-row" key={task.id}>
        <button type="button" onClick={() => navigate('/tasks/' + encodeURIComponent(task.id))}>
          {task.title}<small>Задача{task.description ? ' · ' + task.description : ''}</small>
        </button>
        <button type="button" disabled={state.isLoading} onClick={async () => {
          setFeedback('')
          try {
            await update({ id: task.id, completed: !task.completed }).unwrap()
            setFeedback(task.completed ? 'Задача возвращена к выполнению.' : 'Задача выполнена.')
          } catch { setFeedback('Не удалось изменить статус задачи.') }
        }} aria-label={task.completed ? `Возобновить задачу «${task.title}»` : `Выполнить задачу «${task.title}»`}>
          {task.completed ? 'Возобновить' : 'Выполнить'}
        </button>
      </div>)}
      {!tag && results.projects.map(project => <button key={project.id} type="button"
        onClick={() => navigate('/projects/' + encodeURIComponent(project.id))}>{project.name}<small>Проект</small></button>)}
      {!tag && results.tags.map(result => <button key={result} type="button" onClick={() => {
        setTag(result)
        input.current?.focus()
      }}>#{result}<small>Показать задачи с тегом</small></button>)}
      {tag && <button type="button" onClick={() => { setTag(''); input.current?.focus() }}>Все результаты · #{tag}</button>}
      {query.trim() && !tag && !foundTasks.length && !results.projects.length && !results.tags.length &&
        !tasks.isFetching && !projects.isFetching && <p role="status">Совпадений нет.</p>}
      {!query.trim() && <>
        <button type="button" onClick={create}>Новая задача</button>
        {routes.map(([label, path]) => <button type="button" key={path} onClick={() => navigate(path)}>{label}</button>)}
      </>}
    </div>
  </dialog>
}
