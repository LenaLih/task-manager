import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="workspace auth-workspace">
      <header className="intro">
        <h1>ясно<span className="brand-dot">.</span></h1>
        <p>Меньше шума. Больше фокуса.</p>
      </header>
      <section className="auth-card">{children}</section>
    </main>
  )
}
