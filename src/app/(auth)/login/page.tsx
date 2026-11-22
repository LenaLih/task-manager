import type { Metadata } from 'next'
import { AuthPage } from '../../../components/AuthPage'

export const metadata: Metadata = { title: 'Вход' }

export default function LoginPage() {
  return <AuthPage />
}
