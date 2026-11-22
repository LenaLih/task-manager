import type { Metadata } from 'next'
import { AuthGuard } from '../../components/AuthGuard'
import TaskManager from '../../components/TaskManager'

export const metadata: Metadata = { title: 'Финансы' }

export default function FinancePage() {
  return <AuthGuard><TaskManager finance /></AuthGuard>
}
