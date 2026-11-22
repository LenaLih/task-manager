import Providers from './providers'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '../index.css'
import '../App.css'
import '../Work.css'
import '../Finance.css'

export const metadata: Metadata = {
  title: { default: 'ЯСНО. — Мой день', template: 'ЯСНО. — %s' },
  description: 'Ваше пространство для планов',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' } },
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
