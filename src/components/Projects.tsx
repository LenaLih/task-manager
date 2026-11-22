'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useAddProjectMutation, useProjectsQuery, useUpdateProjectMutation } from '../store/api'
import { projectColors, projectIconLabels, projectIcons } from '../types/task'
import type { Project, ProjectDraft } from '../types/task'

export function ProjectEditor({ project, close }: { project?: Project; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const [add, create] = useAddProjectMutation()
  const [update, edit] = useUpdateProjectMutation()
  const pending = create.isLoading || edit.isLoading
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const values = new FormData(event.currentTarget)
    const name = String(values.get('name')).trim()
    const color = Object.keys(projectColors).find(key => key === values.get('color')) as ProjectDraft['color'] | undefined
    const icon = Object.keys(projectIcons).find(key => key === values.get('icon')) as ProjectDraft['icon'] | undefined
    if (!name || !color || !icon) { setError('Проверьте поля проекта.'); return }
    const draft = { name, description: String(values.get('description')).trim(), color, icon }
    submitting.current = true
    setError('')
    try {
      if (project) await update({ id: project.id, ...draft }).unwrap()
      else await add(draft).unwrap()
      close()
    } catch { setError('Не удалось сохранить проект.') }
    finally { submitting.current = false }
  }

  return (
    <dialog className="work-dialog" ref={dialog} aria-labelledby="project-editor-title"
      onCancel={event => { event.preventDefault(); if (!submitting.current) close() }}>
      <form onSubmit={save} aria-busy={pending}>
        <h2 id="project-editor-title">{project ? 'Настройки проекта' : 'Новый проект'}</h2>
        <label>Название проекта<input name="name" required maxLength={80} defaultValue={project?.name} /></label>
        <label>Описание<textarea name="description" maxLength={1000} rows={3} defaultValue={project?.description} /></label>
        <div className="work-field-pair">
          <label>Цвет<select name="color" defaultValue={project?.color ?? 'green'}>
            {Object.entries(projectColors).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Значок<select name="icon" defaultValue={project?.icon ?? 'folder'}>
            {Object.entries(projectIconLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        {error && <p className="work-error" role="alert">{error}</p>}
        <div className="work-dialog-actions">
          <button type="button" disabled={pending} onClick={close}>Отмена</button>
          <button type="submit" className="add-button" disabled={pending}>Сохранить проект</button>
        </div>
      </form>
    </dialog>
  )
}

function ProjectProgress({ project }: { project: Project }) {
  return <div className="project-progress">
    <progress aria-label="Прогресс проекта" value={project.done} max={project.total || 1} />
    <span>{project.done} из {project.total} выполнено</span>
  </div>
}

export function ProjectDirectory() {
  const { data, isLoading, isError, refetch } = useProjectsQuery()
  const [create, setCreate] = useState(false)
  return <section aria-labelledby="projects-heading">
    <div className="work-section-title">
      <h1 id="projects-heading">Проекты</h1>
      <button type="button" className="add-button" onClick={() => setCreate(true)}>Новый проект</button>
    </div>
    {isLoading ? <p role="status">Загружаем проекты…</p> : isError ? (
      <div role="alert">Не удалось загрузить проекты. <button type="button" onClick={() => void refetch()}>Повторить</button></div>
    ) : data?.length ? (
      <div className="project-grid">
        {data.map(project => <Link href={`/projects/${project.id}`} key={project.id} className="project-tile">
          <span className="project-icon" data-color={project.color} aria-hidden="true">{projectIcons[project.icon]}</span>
          <h2>{project.name}</h2>
          {project.archived && <span className="project-archived">В архиве</span>}
          {project.description && <p>{project.description}</p>}
          <ProjectProgress project={project} />
        </Link>)}
      </div>
    ) : <p className="project-empty">Создайте первый проект, чтобы объединить связанные задачи.</p>}
    {create && <ProjectEditor close={() => setCreate(false)} />}
  </section>
}

export function ProjectHeader({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false)
  const [update, state] = useUpdateProjectMutation()
  return <section className="project-header">
    <div className="work-section-title">
      <h1><span className="project-icon" data-color={project.color} aria-hidden="true">{projectIcons[project.icon]}</span>{project.name}</h1>
      <div className="work-views">
        <button type="button" onClick={() => setEditing(true)}>Редактировать</button>
        <button type="button" disabled={state.isLoading} onClick={() => void update({ id: project.id, archived: !project.archived })}>
          {project.archived ? 'Восстановить проект' : 'Архивировать'}
        </button>
      </div>
    </div>
    {project.archived && <p className="project-archived">В архиве</p>}
    {project.description && <p>{project.description}</p>}
    <ProjectProgress project={project} />
    {state.isError && <p role="alert" className="work-error">Не удалось изменить состояние проекта.</p>}
    {editing && <ProjectEditor project={project} close={() => setEditing(false)} />}
  </section>
}
