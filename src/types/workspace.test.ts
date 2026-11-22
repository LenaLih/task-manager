import { expect, it } from 'vitest'
import { searchWorkspace, upcomingTasks } from './workspace'

const tasks = [
  { id: 'one', title: 'Чертёж', description: 'Уточнить РАЗМЕР', tags: ['план'], completed: false, dueOn: '2026-11-23' },
  { id: 'two', title: 'Макет', tags: ['план'], completed: false, dueOn: '2026-11-21' },
  { id: 'three', title: 'Готово', completed: true, dueOn: '2026-11-22' },
  { id: 'four', title: 'Позже', completed: false, dueOn: '2026-11-26' },
]
const projects = [{ id: 'project', name: 'План работ', description: '', color: 'green', icon: 'flag',
  archived: false, total: 2, done: 0 }] as const

it('searches task names, descriptions, projects and unique tags', () => {
  expect(searchWorkspace(tasks, [...projects], ' чертЁж ').tasks).toEqual([tasks[0]])
  expect(searchWorkspace(tasks, [...projects], 'размер').tasks).toEqual([tasks[0]])
  expect(searchWorkspace(tasks, [...projects], 'ПЛАН')).toEqual({
    tasks: tasks.slice(0, 2), tags: ['план'], projects: [...projects],
  })
})

it('shows open overdue tasks and deadlines through the configured last day', () => {
  expect(upcomingTasks(tasks, '2026-11-22', 0)).toEqual([])
  expect(upcomingTasks(tasks, '2026-11-22', 1)).toEqual([tasks[1], tasks[0]])
})
