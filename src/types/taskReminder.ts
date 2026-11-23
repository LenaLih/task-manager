import { statusOf } from './task'
import type { WorkspaceTask } from './task'

export const reminderGraceMs = 5 * 60_000

// Shared event shape for a future delivery transport, independent of browser permissions.
export type TaskReminder = { id: string; taskId: string; title: string; at: number }

export function readyTaskReminders(tasks: WorkspaceTask[], now: number): TaskReminder[] {
  return tasks.flatMap(task => {
    const at = task.remindAt
    if (task.completed || statusOf(task) === 'done' || at == null || !Number.isFinite(at) ||
      at > now || now - at >= reminderGraceMs) return []
    return [{ id: `${task.id}:${at}`, taskId: task.id, title: task.title, at }]
  })
}
