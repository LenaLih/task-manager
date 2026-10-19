import { AuthGuard } from '../components/AuthGuard'
import TaskManager from '../components/TaskManager'

export default function HomePage() {
  return (
    <AuthGuard>
      <TaskManager />
    </AuthGuard>
  )
}
