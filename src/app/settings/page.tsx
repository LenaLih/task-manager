import type { Metadata } from 'next'
import { AuthGuard } from '../../components/AuthGuard'
import TaskManager from '../../components/TaskManager'

export const metadata: Metadata = { title: 'Настройки' }

export default function SettingsPage() {
  return <AuthGuard><TaskManager settings /></AuthGuard>
}
