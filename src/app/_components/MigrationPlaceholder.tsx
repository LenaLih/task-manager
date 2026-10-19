import Link from 'next/link'

type MigrationPlaceholderProps = {
  title: string
  description: string
}

export function MigrationPlaceholder({
  title,
  description,
}: MigrationPlaceholderProps) {
  return (
    <main className="workspace">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">✓</span>
        <span>ясно<span className="brand-dot">.</span></span>
        <span className="brand-caption">МЕНЬШЕ ШУМА. БОЛЬШЕ ФОКУСА.</span>
      </header>
      <section className="intro">
        <span className="eyebrow">ВАШЕ ПРОСТРАНСТВО ДЛЯ ПЛАНОВ</span>
        <h1>Большие дела.<br /><span>Маленькие шаги.</span></h1>
        <p>Соберите мысли в список. Двигайтесь в своём ритме.</p>
      </section>
      <section className="task-panel" aria-label={title}>
        <div className="panel-heading"><h2>{title}</h2></div>
        <div className="auth-form">
          <p>{description}</p>
          <nav className="account" aria-label="Основная навигация">
            <Link href="/">Мои задачи</Link>
            <Link href="/login">Вход</Link>
            <Link href="/register">Регистрация</Link>
          </nav>
        </div>
      </section>
    </main>
  )
}
