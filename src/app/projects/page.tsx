import type { Metadata } from 'next'
import { AuthGuard } from '../../components/AuthGuard'
import TaskManager from '../../components/TaskManager'

export const metadata: Metadata = { title: 'Проекты' }

export default function ProjectsPage() {
  return <AuthGuard><TaskManager directory /></AuthGuard>
}
