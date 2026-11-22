import { useState } from 'react'
import { useProjectsQuery } from '../store/api'
import { statusLabels, taskStatuses } from '../types/task'
import type { BulkAction } from '../types/task'

export function TaskBulkActions({ count, pending, apply, clear }: {
  count: number
  pending: boolean
  apply: (action: BulkAction) => void
  clear: () => void
}) {
  const [action, setAction] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data } = useProjectsQuery()
  return <div className="work-bulk" aria-label="Массовые действия">
    <strong>Выбрано: {count}</strong>
    <select aria-label="Действие для выбранных задач" value={action} disabled={pending}
      onChange={event => { setAction(event.target.value); setConfirmDelete(false) }}>
      <option value="">Выберите действие</option>
      <optgroup label="Изменить статус">
        {taskStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
      </optgroup>
      <optgroup label="Переместить в проект">
        <option value="project:">Без проекта</option>
        {data?.filter(project => !project.archived).map(project =>
          <option key={project.id} value={`project:${project.id}`}>{project.name}</option>)}
      </optgroup>
      <option value="delete">Удалить выбранные</option>
    </select>
    <button type="button" disabled={!action || pending} onClick={() => {
      const status = taskStatuses.find(item => item === action)
      if (status) apply({ type: 'status', status })
      else if (action.startsWith('project:')) apply({ type: 'project', projectId: action.slice(8) || null })
      else if (action === 'delete' && confirmDelete) apply({ type: 'delete' })
      else if (action === 'delete') setConfirmDelete(true)
    }}>{confirmDelete ? 'Подтвердить удаление' : 'Применить'}</button>
    <button type="button" disabled={pending} onClick={clear}>Снять выбор</button>
  </div>
}
