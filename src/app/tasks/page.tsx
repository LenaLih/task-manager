import type { Metadata } from 'next'
import { AuthGuard } from '../../components/AuthGuard'
import TaskManager from '../../components/TaskManager'

export const metadata: Metadata = { title: 'Мои задачи' }

export default function TasksPage() {
  return <AuthGuard><TaskManager tasksOnly /></AuthGuard>
}
