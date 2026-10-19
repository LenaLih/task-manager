// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TaskForm } from './TaskForm'
import { TaskList } from './TaskList'
afterEach(cleanup)
it('keeps the draft on create failure and clears it after success', async () => {
  const add = vi.fn<(title: string) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  render(<TaskForm onAdd={add} pending={false} />)
  const input = screen.getByLabelText('Название новой задачи')
  fireEvent.change(input, { target: { value: ' Plan ' } })
  fireEvent.click(screen.getByRole('button', { name: /Добавить/ }))
  await waitFor(() => expect(add).toHaveBeenCalledWith('Plan'))
  expect(input).toHaveValue(' Plan ')
  fireEvent.click(screen.getByRole('button', { name: /Добавить/ }))
  await waitFor(() => expect(input).toHaveValue(''))
})
it('shows the empty state and disables changes while a task is being saved', () => {
  const props = { busy: new Set<string>(), onToggle: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), filter: 'all' as const }
  const view = render(<TaskList {...props} tasks={[]} />)
  expect(screen.getByText('Начните с маленького шага')).toBeInTheDocument()
  view.rerender(<TaskList {...props} busy={new Set(['1'])} tasks={[{ id: '1', title: 'Plan', completed: false }]} />)
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Удалить задачу: Plan' })).toBeDisabled()
})
