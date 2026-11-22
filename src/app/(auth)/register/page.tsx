import type { Metadata } from 'next'
import { AuthPage } from '../../../components/AuthPage'

export const metadata: Metadata = { title: 'Регистрация' }

export default function RegisterPage() {
  return <AuthPage register />
}
