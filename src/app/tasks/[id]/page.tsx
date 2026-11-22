import type { Metadata } from 'next'
import { AuthGuard } from '../../../components/AuthGuard'
import TaskManager from '../../../components/TaskManager'

export const metadata: Metadata = { title: 'Задача' }

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AuthGuard><TaskManager key={id} taskId={id} /></AuthGuard>
}
