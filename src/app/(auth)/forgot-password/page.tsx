import type { Metadata } from 'next'
import { PasswordRecovery } from '../../../components/PasswordRecovery'

export const metadata: Metadata = { title: 'Восстановление пароля' }

export default function ForgotPasswordPage() {
  return <PasswordRecovery />
}
