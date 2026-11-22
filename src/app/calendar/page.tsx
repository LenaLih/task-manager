import type { Metadata } from 'next'
import { AuthGuard } from '../../components/AuthGuard'
import TaskManager from '../../components/TaskManager'

export const metadata: Metadata = { title: 'Календарь' }

export default function CalendarPage() {
  return <AuthGuard><TaskManager planning="calendar" /></AuthGuard>
}
