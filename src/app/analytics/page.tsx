import type { Metadata } from 'next'
import { AuthGuard } from '../../components/AuthGuard'
import TaskManager from '../../components/TaskManager'

export const metadata: Metadata = { title: 'Аналитика' }

export default function AnalyticsPage() {
  return <AuthGuard><TaskManager planning="analytics" /></AuthGuard>
}
