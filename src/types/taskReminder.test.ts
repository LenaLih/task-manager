import { expect, it } from 'vitest'
import { readyTaskReminders, reminderGraceMs } from './taskReminder'

it('selects only current, unfinished reminders and changes the event identity when rescheduled', () => {
  const at = Date.parse('2026-12-30T13:45:00Z')
  const task = { id: 'task', title: 'Торт', completed: false, remindAt: at }
  expect(readyTaskReminders([task], at - 1)).toEqual([])
  expect(readyTaskReminders([task], at)).toEqual([{ id: `task:${at}`, taskId: 'task', title: 'Торт', at }])
  expect(readyTaskReminders([task], at + reminderGraceMs)).toEqual([])
  expect(readyTaskReminders([{ ...task, completed: true }, { ...task, status: 'done' }, { ...task, remindAt: null }], at))
    .toEqual([])
  expect(readyTaskReminders([{ ...task, remindAt: at + 1 }], at + 1)[0].id).toBe(`task:${at + 1}`)
})
