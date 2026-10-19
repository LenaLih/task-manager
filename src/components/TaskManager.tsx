'use client'

import { useState } from 'react'
import type { Task, TaskFilter } from '../types/task'
import {
  useTasksQuery,
  useAddTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useLogoutMutation,
} from '../store/api'
import { useAppSelector } from '../store'
import { TaskForm } from './TaskForm'
import { TaskFilters } from './TaskFilters'
import { TaskList } from './TaskList'

function TaskManager() {
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<Set<Task['id']>>(new Set())
  const { initialized, session } = useAppSelector((state) => state.auth)
  const { data: tasks = [], isLoading, isFetching, isError, refetch } = useTasksQuery(
    undefined,
    { skip: !initialized || !session, refetchOnMountOrArgChange: true },
  )
  const [addTask, addState] = useAddTaskMutation()
  const [updateTask] = useUpdateTaskMutation()
  const [deleteTask] = useDeleteTaskMutation()
  const [logout, logoutState] = useLogoutMutation()
  const user = useAppSelector((state) => state.auth.session?.user)

  async function handleAddTask(title: Task['title']): Promise<boolean> {
    setError('')

    try {
      await addTask(title).unwrap()
      return true
    } catch {
      setError('Не удалось добавить задачу. Повторите попытку.')
      return false
    }
  }

  async function runTaskMutation(
    id: Task['id'],
    operation: () => Promise<unknown>,
  ): Promise<void> {
    if (busy.has(id)) return

    setBusy((previous) => new Set(previous).add(id))
    setError('')

    try {
      await operation()
    } catch {
      setError('Не удалось сохранить изменение. Повторите попытку.')
    } finally {
      setBusy((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  function handleToggleTask(id: Task['id']): void {
    const task = tasks.find((task) => task.id === id)

    if (task) {
      void runTaskMutation(id, () => (
        updateTask({ id, completed: !task.completed }).unwrap()
      ))
    }
  }

  function handleDeleteTask(id: Task['id']): void {
    void runTaskMutation(id, () => deleteTask(id).unwrap())
  }

  function handleEditTask(id: Task['id'], title: Task['title']): void {
    void runTaskMutation(id, () => updateTask({ id, title }).unwrap())
  }

  async function handleLogout(): Promise<void> {
    try {
      await logout().unwrap()
    } catch {
      setError('Не удалось завершить сессию на сервере. Повторите выход.')
    }
  }

  const remaining = tasks.filter((task) => !task.completed).length
  const done = tasks.length - remaining
  const progress = tasks.length ? Math.round(done / tasks.length * 100) : 0
  const visibleTasks = tasks.filter((task) => (
    filter === 'all' ||
    (filter === 'completed' ? task.completed : !task.completed)
  ))

  return (
    <main className="workspace">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">✓</span>
        <span>
          ясно<span className="brand-dot">.</span>
        </span>
        <span className="brand-caption">МЕНЬШЕ ШУМА. БОЛЬШЕ ФОКУСА.</span>
      </header>

      <section className="intro">
        <span className="eyebrow">ВАШЕ ПРОСТРАНСТВО ДЛЯ ПЛАНОВ</span>
        <h1>
          Большие дела.<br />
          <span>Маленькие шаги.</span>
        </h1>
        <p>Соберите мысли в список. Двигайтесь в своём ритме.</p>
      </section>

      <section className="task-panel" aria-label="Менеджер задач">
        <div className="panel-heading">
          <div>
            <h2>Мои задачи</h2>
            <p>Один шаг ближе к тому, что важно</p>
          </div>
          <div className="account">
            <span>{user?.email}</span>
            <button
              disabled={logoutState.isLoading}
              onClick={() => void handleLogout()}
            >
              Выйти
            </button>
            <span className="total-badge">Всего: {tasks.length}</span>
          </div>
        </div>

        <TaskForm onAdd={handleAddTask} pending={addState.isLoading} />

        <div className="list-toolbar">
          <TaskFilters value={filter} onChange={setFilter} />
          <span className="remaining" aria-live="polite">
            Осталось: <strong>{remaining}</strong>
          </span>
        </div>

        {isLoading ? (
          <p className="empty-state" role="status">Загружаем задачи…</p>
        ) : isError ? (
          <div className="empty-state" role="alert">
            <p>Не удалось загрузить задачи.</p>
            <button disabled={isFetching} onClick={() => void refetch()}>Повторить</button>
          </div>
        ) : (
          <TaskList
            busy={busy}
            tasks={visibleTasks}
            filter={filter}
            onToggle={handleToggleTask}
            onDelete={handleDeleteTask}
            onEdit={handleEditTask}
          />
        )}

        <footer className="panel-footer">
          <div>
            <span className="progress-dot" />
            Выполнено {done} из {tasks.length}
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Прогресс выполнения"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <span>{progress}%</span>
        </footer>

        {error && (
          <p className="storage-error" role="alert">{error}</p>
        )}
      </section>

      <p className="page-note">
        <span aria-hidden="true">✧</span>{' '}
        Ваши задачи сохраняются в личном аккаунте
      </p>
    </main>
  )
}

export default TaskManager
