import type { Metadata } from 'next'
import { PasswordRecovery } from '../../../components/PasswordRecovery'

export const metadata: Metadata = { title: 'Новый пароль' }

export default function ResetPasswordPage() {
  return <PasswordRecovery reset />
}
