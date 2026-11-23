'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { priorityLabels, statusLabels, statusOf, taskPriorities, taskStatuses } from '../types/task'
import type { BulkAction, Task, TaskFilter, TaskStatus, WorkspaceTask } from '../types/task'
import {
  useTasksQuery,
  useAddTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useLogoutMutation,
  useProjectQuery,
  useBulkTasksMutation,
  useProfileQuery,
  useTaskQuery,
  useUpdateProfileMutation,
} from '../store/api'
import { useAppSelector } from '../store'
import { useTaskViewPreference } from '../store/taskViewPreference'
import { TaskForm } from './TaskForm'
import { TaskFilters } from './TaskFilters'
import { TaskList } from './TaskList'
import { TaskBoard } from './TaskBoard'
import { TaskDetailsDialog } from './TaskDetailsDialog'
import type { TaskDraft } from './TaskDetailsDialog'
import { TaskOverview } from './TaskOverview'
import { ProjectDirectory, ProjectHeader } from './Projects'
import { TaskBulkActions } from './TaskBulkActions'
import { ErrorState } from './ErrorState'
import { TaskCalendar } from './TaskCalendar'
import { WorkspaceAnalytics } from './WorkspaceAnalytics'
import { AccountSettings } from './AccountSettings'
import { FinanceWorkspace } from './FinanceWorkspace'
import { CommandPalette } from './CommandPalette'
import { SavedFilters } from './SavedFilters'
import { localDay } from '../types/planning'
import { upcomingTasks } from '../types/workspace'

const themeKey = 'yasno-work-theme'
const sections = [
  ['Обзор', '/#overview', '/'], ['Мои задачи', '/tasks', '/tasks'], ['Проекты', '/projects', '/projects'],
  ['Календарь', '/calendar', '/calendar'], ['Аналитика', '/analytics', '/analytics'],
  ['Финансы', '/finance', '/finance'], ['Настройки', '/settings', '/settings'],
] as const
function listenForTheme(change: () => void) {
  window.addEventListener('storage', change)
  window.addEventListener(themeKey, change)
  return () => {
    window.removeEventListener('storage', change)
    window.removeEventListener(themeKey, change)
  }
}
function readTheme(): 'dark' | 'light' {
  try { return localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light' }
  catch { return 'light' }
}
function defaultTheme() { return 'light' as const }

function TaskManager({ directory = false, projectId, tasksOnly = false, planning, settings = false, taskId, finance = false }: {
  directory?: boolean
  projectId?: string
  tasksOnly?: boolean
  planning?: 'calendar' | 'analytics'
  settings?: boolean
  finance?: boolean
  taskId?: string
}) {
  const localTheme = useSyncExternalStore(listenForTheme, readTheme, defaultTheme)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState('added')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<WorkspaceTask | 'new' | null>(null)
  const [detailsDismissed, setDetailsDismissed] = useState(false)
  const [palette, setPalette] = useState(false)
  const [error, setError] = useState('')
  const [retryingTasks, setRetryingTasks] = useState(false)
  const [busy, setBusy] = useState<Set<Task['id']>>(new Set())
  const { initialized, session } = useAppSelector((state) => state.auth)
  const profile = useProfileQuery(undefined, { skip: !session })
  const [updateProfile, themeState] = useUpdateProfileMutation()
  const theme = profile.data?.theme ?? localTheme
  const [view, setView] = useTaskViewPreference(session?.user.id)
  const { data: allTasks = [], isLoading, isFetching, isError, refetch } = useTasksQuery(
    undefined,
    { skip: directory || settings || finance || !!taskId || planning === 'analytics' || !initialized || !session, refetchOnMountOrArgChange: true },
  )
  const project = useProjectQuery(projectId ?? '', { skip: !projectId })
  const directTask = useTaskQuery(taskId ?? '', { skip: !taskId })
  const missingTask = directTask.isError && 'status' in directTask.error && directTask.error.status === 404
  const detail = missingTask ? undefined : directTask.currentData
  const activeEditor = editor ?? (detailsDismissed ? undefined : detail)
  const tasks = projectId ? allTasks.filter(task => task.projectId === projectId) : allTasks
  const [addTask, addState] = useAddTaskMutation()
  const [updateTask] = useUpdateTaskMutation()
  const [deleteTask] = useDeleteTaskMutation()
  const [logout, logoutState] = useLogoutMutation()
  const [applyBulk, bulkState] = useBulkTasksMutation()
  const user = useAppSelector((state) => state.auth.session?.user)

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (!event.repeat) setPalette(value => !value)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  async function handleAddTask(title: Task['title'], dueOn?: string): Promise<boolean> {
    setError('')

    try {
      await addTask(projectId || dueOn ? { title, projectId, dueOn } : title).unwrap()
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

  function moveTask(id: string, status: TaskStatus) {
    void runTaskMutation(id, () => updateTask({ id, status }).unwrap())
  }

  function retryTasks() {
    setRetryingTasks(true)
    void refetch().finally(() => setRetryingTasks(false))
  }

  function moveDeadline(task: WorkspaceTask, dueOn: string) {
    if (task.startsOn && dueOn < task.startsOn) {
      setError('Дедлайн должен быть не раньше даты начала.')
      return
    }
    void runTaskMutation(task.id, () => updateTask({ id: task.id, dueOn }).unwrap())
  }

  async function saveDetails(draft: TaskDraft) {
    if (editor === 'new') await addTask(draft).unwrap()
    else if (activeEditor && activeEditor !== 'new') {
      const changed = Object.fromEntries(Object.entries(draft).filter(([field, value]) => (
        JSON.stringify(activeEditor[field as keyof TaskDraft]) !== JSON.stringify(value)
      ))) as Partial<TaskDraft>
      if (Object.keys(changed).length) await updateTask({ id: activeEditor.id, ...changed }).unwrap()
    }
  }

  function selectTask(id: string) {
    setSelected(old => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else if (next.size < 100) next.add(id)
      return next
    })
  }

  async function handleBulk(action: BulkAction) {
    setError('')
    try {
      await applyBulk({ ids: [...selected], action }).unwrap()
      setSelected(new Set())
      setSelecting(false)
    } catch {
      setError('Не удалось применить действие. Проверьте выбранные задачи и проект.')
    }
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
  const query = search.trim().toLocaleLowerCase()
  const tags = [...new Set(tasks.flatMap(task => task.tags ?? []))].sort()
  const categories = [...new Set(tasks.flatMap(task => task.category ? [task.category] : []))].sort()
  const visibleTasks = tasks.filter(task =>
    (filter === 'all' || (filter === 'completed' ? task.completed : !task.completed)) &&
    (!statusFilter || statusOf(task) === statusFilter) &&
    (!priorityFilter || (task.priority ?? 'medium') === priorityFilter) &&
    (!tagFilter || task.tags?.includes(tagFilter)) &&
    (!categoryFilter || task.category === categoryFilter) &&
    (!query || `${task.title} ${task.description ?? ''} ${task.category ?? ''} ${task.tags?.join(' ') ?? ''}`.toLocaleLowerCase().includes(query)),
  )
  if (sort === 'title') visibleTasks.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'deadline') visibleTasks.sort((a, b) => (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31'))
  const overview = !tasksOnly && !projectId && !directory && !settings && !finance && !planning && !taskId
  const activeSection = finance ? '/finance' : settings ? '/settings' : planning ? '/' + planning :
    projectId || directory ? '/projects' : tasksOnly || taskId ? '/tasks' : '/'
  const [today, setToday] = useState(() => localDay())
  useEffect(() => {
    if (!overview) return
    const timer = window.setInterval(() => setToday(localDay()), 60_000)
    return () => window.clearInterval(timer)
  }, [overview])
  const reminders = overview ? upcomingTasks(tasks, today, profile.data?.reminderDays ?? 0) : []

  return (
    <div className="work-shell" data-theme={theme}>
      <aside className="work-sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">✓</span>
          <span>ясно<span className="brand-dot">.</span></span>
        </Link>
        <nav aria-label="Рабочее пространство">
          {sections.map(([name, href, section]) => <Link key={href} href={href}
            className={section === '/settings' ? 'work-nav-settings' : undefined}
            aria-current={activeSection === section ? 'page' : undefined}>{name}</Link>)}
        </nav>
        <div className="work-account">
          <button type="button" aria-keyshortcuts="Control+K" onClick={() => setPalette(true)}>Поиск <kbd>Ctrl+K</kbd></button>
          <button type="button" aria-pressed={theme === 'dark'} disabled={themeState.isLoading} onClick={async () => {
            await updateProfile({ theme: theme === 'dark' ? 'light' : 'dark' })
          }}>Тёмная тема</button>
          <span title={profile.data?.email ?? user?.email}>{profile.data?.name || profile.data?.email || user?.email}</span>
          {themeState.isError && <p className="work-error" role="alert">Не удалось изменить тему.</p>}
          <button type="button" disabled={logoutState.isLoading} onClick={() => void handleLogout()}>
            Выйти
          </button>
        </div>
      </aside>
      <main className="work-main">
        {finance ? <FinanceWorkspace /> : settings ? <AccountSettings theme={theme} /> : taskId ? <section className="task-panel work-settings-card">
          <Link href="/tasks">К задачам</Link>
          {directTask.isLoading && <p role="status">Загружаем задачу…</p>}
          {directTask.isError && (missingTask
            ? <p role="alert">Задача недоступна.</p>
            : <ErrorState message="Не удалось загрузить задачу." retryLabel="Повторить"
              pending={directTask.isFetching} onRetry={directTask.refetch} />)}
          {detail && <><h1>{detail.title}</h1>
            <button type="button" onClick={() => setEditor(detail)}>Открыть детали</button></>}
        </section> : planning === 'analytics' ? <WorkspaceAnalytics /> : planning === 'calendar' ? <>
          {isLoading && <p role="status">Загружаем задачи…</p>}
          {isError || retryingTasks ? (
            <ErrorState message={retryingTasks ? 'Загружаем задачи…' : 'Не удалось загрузить календарь.'}
              retryLabel="Повторить" pending={isFetching || retryingTasks} onRetry={retryTasks} />
          ) : <TaskCalendar tasks={tasks} busy={busy} open={setEditor} move={moveDeadline} />}
          {error && <p className="storage-error" role="alert">{error}</p>}
        </> : directory ? <ProjectDirectory /> : overview ? (
          <TaskOverview tasks={tasks} today={today} name={profile.data?.name} reminders={reminders}
            loading={isLoading && !retryingTasks} failed={isError} retrying={retryingTasks} retry={retryTasks}
            open={setEditor} toggle={handleToggleTask} busy={busy} add={title => handleAddTask(title, today)}
            adding={addState.isLoading} error={error} />
        ) : projectId && !project.data ? (
          project.isLoading ? <p role="status">Загружаем проект…</p> :
            <p role="alert">Проект недоступен. <Link href="/projects">К проектам</Link></p>
        ) : <>
        {project.data && <ProjectHeader project={project.data} />}
      <section id="tasks" className="task-panel work-tasks" aria-label="Менеджер задач">
        <div className="panel-heading">
          <div>
            <h2>Мои задачи</h2>
            <p>Всего: {tasks.length}</p>
          </div>
          <button className="add-button" type="button" disabled={project.data?.archived}
            onClick={() => setEditor('new')}>Новая задача</button>
        </div>

        {!project.data?.archived && <TaskForm onAdd={handleAddTask} pending={addState.isLoading} />}

        <div className="list-toolbar">
          <TaskFilters value={filter} onChange={setFilter} />
          <span className="remaining" aria-live="polite">
            Осталось: <strong>{remaining}</strong>
          </span>
        </div>
        <div className="work-tools">
          <input type="search" aria-label="Поиск задач" placeholder="Поиск задач" value={search} maxLength={300}
            onChange={event => setSearch(event.target.value)} />
          <select aria-label="Фильтр по статусу" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="">Все статусы</option>
            {taskStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select>
          <select aria-label="Фильтр по приоритету" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}>
            <option value="">Все приоритеты</option>
            {taskPriorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
          </select>
          {(tags.length > 0 || tagFilter) && <select aria-label="Фильтр по тегу" value={tagFilter}
            onChange={event => setTagFilter(event.target.value)}>
            <option value="">Все теги</option>
            {tags.map(tag => <option key={tag}>{tag}</option>)}
          </select>}
          {(categories.length > 0 || categoryFilter) && <select aria-label="Фильтр по категории" value={categoryFilter}
            onChange={event => setCategoryFilter(event.target.value)}>
            <option value="">Все категории</option>
            {categories.map(category => <option key={category}>{category}</option>)}
          </select>}
          <select aria-label="Сортировка задач" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="added">По добавлению</option>
            <option value="title">По названию</option>
            <option value="deadline">По дедлайну</option>
          </select>
          <div className="work-views" aria-label="Вид задач">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>Список</button>
            <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Kanban</button>
            {view === 'list' && tasks.length > 0 && <button type="button" aria-pressed={selecting}
              onClick={() => { setSelecting(!selecting); if (selecting) setSelected(new Set()) }}>Выбрать задачи</button>}
          </div>
        </div>
        <SavedFilters current={{ filter, status: statusFilter, priority: priorityFilter, tag: tagFilter,
          category: categoryFilter, sort, search }} apply={filters => {
          setFilter(filters.filter)
          setStatusFilter(filters.status)
          setPriorityFilter(filters.priority)
          setTagFilter(filters.tag)
          setCategoryFilter(filters.category)
          setSort(filters.sort)
          setSearch(filters.search)
        }} />
        {view === 'list' && selecting && selected.size > 0 && <TaskBulkActions count={selected.size}
          pending={bulkState.isLoading} apply={action => void handleBulk(action)} clear={() => setSelected(new Set())} />}

        {isLoading && !retryingTasks ? (
          <p className="empty-state" role="status">Загружаем задачи…</p>
        ) : isError || retryingTasks ? (
          <ErrorState message={retryingTasks ? 'Загружаем задачи…' : 'Не удалось загрузить задачи.'}
            retryLabel="Повторить" pending={isFetching || retryingTasks} onRetry={retryTasks} />
        ) : !visibleTasks.length && (query || statusFilter || priorityFilter || tagFilter || categoryFilter) ? (
          <p className="empty-state">По заданным условиям ничего не найдено.</p>
        ) : view === 'board' ? (
          <TaskBoard tasks={visibleTasks} busy={busy} move={moveTask} open={setEditor} />
        ) : (
          <TaskList
            busy={busy}
            tasks={visibleTasks}
            filter={filter}
            onToggle={handleToggleTask}
            onDelete={handleDeleteTask}
            onEdit={handleEditTask}
            onDetails={setEditor}
            selection={selecting ? selected : undefined}
            onSelect={selectTask}
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
        </>}

      </main>
      {activeEditor && <TaskDetailsDialog key={activeEditor === 'new' ? 'new' : activeEditor.id}
        task={activeEditor === 'new' ? undefined : activeEditor}
        projectId={project.data?.archived ? undefined : projectId}
        save={saveDetails} close={() => { setDetailsDismissed(true); setEditor(null) }} />}
      {palette && <CommandPalette close={() => setPalette(false)} create={() => { setPalette(false); setEditor('new') }} />}
    </div>
  )
}

export default TaskManager
