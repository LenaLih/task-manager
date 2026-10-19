import Providers from './providers'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '../index.css'
import '../App.css'

export const metadata: Metadata = {
  title: 'Ясно — Task Manager',
  description: 'Ваше пространство для планов',
  icons: { icon: '/favicon.svg' },
}

type RootLayoutProps = {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
