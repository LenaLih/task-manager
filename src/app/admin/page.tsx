import type { Metadata } from 'next'
import { AuthGuard } from '../../components/AuthGuard'
import TaskManager from '../../components/TaskManager'
import './admin.css'

export const metadata: Metadata = { title: 'Администрирование' }

export default function AdminPage() {
  return <AuthGuard><TaskManager admin /></AuthGuard>
}
