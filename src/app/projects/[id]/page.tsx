import type { Metadata } from 'next'
import { AuthGuard } from '../../../components/AuthGuard'
import TaskManager from '../../../components/TaskManager'

export const metadata: Metadata = { title: 'Проект' }

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AuthGuard><TaskManager key={id} projectId={id} /></AuthGuard>
}
