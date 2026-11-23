'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAppSelector } from '../store'
import { useTasksQuery } from '../store/api'
import { readyTaskReminders } from '../types/taskReminder'
import type { TaskReminder } from '../types/taskReminder'

const permissionEvent = 'yasno-notification-permission'
type Permission = NotificationPermission | 'unsupported' | 'unknown'

function permission(): Permission {
  return window.isSecureContext && typeof Notification === 'function' && typeof Notification.requestPermission === 'function'
    ? Notification.permission : 'unsupported'
}

function subscribe(callback: () => void) {
  window.addEventListener(permissionEvent, callback)
  window.addEventListener('focus', callback)
  let observed: PermissionStatus | undefined
  let mounted = true
  void navigator.permissions?.query({ name: 'notifications' }).then(status => {
    if (!mounted) return
    observed = status
    observed.addEventListener('change', callback)
    callback()
  }).catch(() => {})
  return () => {
    mounted = false
    observed?.removeEventListener('change', callback)
    window.removeEventListener(permissionEvent, callback)
    window.removeEventListener('focus', callback)
  }
}

const serverPermission = (): Permission => 'unknown'

export function TaskNotificationPermission() {
  const status = useSyncExternalStore(subscribe, permission, serverPermission)
  const [error, setError] = useState(false)
  const [requesting, setRequesting] = useState(false)

  async function enable() {
    if (permission() !== 'default') return
    setRequesting(true)
    setError(false)
    try { await Notification.requestPermission() } catch { setError(true) }
    finally {
      setRequesting(false)
      window.dispatchEvent(new Event(permissionEvent))
    }
  }

  if (status === 'unknown') return null
  return <section className="my-day-card" aria-labelledby="task-notification-heading">
    <h2 id="task-notification-heading">Уведомления о задачах</h2>
    <p>{status === 'granted' ? 'Разрешены. Напоминания работают, пока приложение открыто.'
      : status === 'denied' ? 'Заблокированы. Разрешение можно изменить в настройках сайта в браузере.'
        : status === 'unsupported' ? 'Браузер не поддерживает уведомления в этом режиме.'
          : 'Разрешите уведомления, чтобы получать напоминания при открытом приложении.'}</p>
    {status === 'default' && <div className="work-views task-notification-actions">
      <button type="button" disabled={requesting} onClick={() => void enable()}>Разрешить уведомления</button>
    </div>}
    {error && <p role="alert" className="work-error">Не удалось запросить разрешение на уведомления.</p>}
  </section>
}

function delivered(key: string): Record<string, number> {
  return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>
}

let workerRegistration: Promise<ServiceWorkerRegistration | null> | undefined
function getNotificationWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  workerRegistration ??= navigator.serviceWorker.register('/task-notifications.js').then(async registration => {
    if (registration.active) return registration
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), 3000)),
    ])
    if (!ready) workerRegistration = undefined
    return ready
  }).catch(() => {
    workerRegistration = undefined
    return null
  })
  return workerRegistration
}

async function deliver(key: string, reminder: TaskReminder, active: () => boolean) {
  const send = async () => {
    if (!active() || permission() !== 'granted') return
    const events = delivered(key)
    if (events[reminder.id]) return
    const worker = await getNotificationWorker()
    if (!active() || permission() !== 'granted') return
    const options = { body: reminder.title, tag: reminder.id, data: { taskId: reminder.taskId } }
    const recentEvents = Object.fromEntries(Object.entries(delivered(key))
      .filter(([, at]) => at > Date.now() - 86_400_000))
    if (recentEvents[reminder.id]) return
    localStorage.setItem(key, JSON.stringify({ ...recentEvents, [reminder.id]: reminder.at }))
    try {
      if (worker) await worker.showNotification('Напоминание о задаче', options)
      else {
        const notification = new Notification('Напоминание о задаче', options)
        notification.onclick = () => {
          window.focus()
          window.location.assign('/tasks/' + encodeURIComponent(reminder.taskId))
          notification.close()
        }
      }
    } catch {
      const latest = delivered(key)
      delete latest[reminder.id]
      localStorage.setItem(key, JSON.stringify(latest))
    }
  }
  if (navigator.locks) await navigator.locks.request(key, send)
  else await send()
}

export function TaskNotificationScheduler() {
  const owner = useAppSelector(state => state.auth.session?.user.id)
  const status = useSyncExternalStore(subscribe, permission, serverPermission)
  const enabled = Boolean(owner) && status === 'granted'
  const { currentData: tasks, refetch } = useTasksQuery(undefined, { skip: !enabled, pollingInterval: 30_000 })

  useEffect(() => {
    if (!enabled || !owner || !tasks) return
    const key = 'yasno-task-notifications:' + owner
    let mounted = true
    let checking = false
    async function check() {
      if (!mounted || checking || permission() !== 'granted') return
      checking = true
      try {
        const seen = delivered(key)
        if (!readyTaskReminders(tasks ?? [], Date.now()).some(event => !seen[event.id])) return
        const fresh = await refetch().unwrap()
        for (const event of readyTaskReminders(fresh, Date.now())) await deliver(key, event, () => mounted)
      } catch {
        // A failed request or inaccessible storage must not deliver stale or duplicate reminders.
      } finally { checking = false }
    }
    const handle = () => { void check() }
    handle()
    const timer = window.setInterval(handle, 10_000)
    document.addEventListener('visibilitychange', handle)
    return () => {
      mounted = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handle)
    }
  }, [enabled, owner, tasks, refetch])
  return null
}
