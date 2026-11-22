import { useCallback, useSyncExternalStore } from 'react'

type TaskView = 'list' | 'board'
const defaultView = (): TaskView => 'list'
const preferenceChange = 'yasno-task-view-change'

export function useTaskViewPreference(userId: string | undefined) {
  const key = userId ? `yasno-task-view:${userId}` : undefined
  const read = useCallback((): TaskView => {
    try {
      return key && window.localStorage.getItem(key) === 'board' ? 'board' : 'list'
    } catch {
      return 'list'
    }
  }, [key])
  const subscribe = useCallback((change: () => void) => {
    function onStorage(event: StorageEvent) {
      if (event.key === key || event.key === null) change()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(preferenceChange, change)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(preferenceChange, change)
    }
  }, [key])
  const view = useSyncExternalStore(subscribe, read, defaultView)

  function setView(value: TaskView) {
    if (!key) return
    try {
      window.localStorage.setItem(key, value)
      window.dispatchEvent(new Event(preferenceChange))
    } catch {
      // Storage can be disabled by browser settings.
    }
  }

  return [view, setView] as const
}
