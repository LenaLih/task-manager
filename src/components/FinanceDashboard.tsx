import { currencyBalances, money, monthSummary, percentage } from '../types/finance'
import type { Currency, FinanceSnapshot } from '../types/finance'

export function FinanceDashboard({ data, balances, currency, month }: {
  data: FinanceSnapshot; balances: Map<string, bigint>; currency: Currency; month: string
}) {
  const previousDate = new Date(month + '-01T00:00:00Z')
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1)
  const previousMonth = previousDate.toISOString().slice(0, 7)
  const current = monthSummary(data.entries, currency, month)
  const previous = monthSummary(data.entries, currency, previousMonth)
  const dates = [...current.days].sort(([a], [b]) => a.localeCompare(b))
  const peak = dates.reduce((max, [, amount]) => amount > max ? amount : max, 0n)
  const categories = [...current.categories].sort(([, a], [, b]) => a === b ? 0 : a > b ? -1 : 1)
  const totals = currencyBalances(data.accounts, balances)
  return <>
    <section className="finance-panel finance-balance">
      <h2>Общий остаток</h2>
      <div className="finance-metrics">{totals.map(({ code, total }) => <div key={code}>
        <span>{code}</span><strong>{money(total, code)}</strong>
      </div>)}</div>
      {data.accounts.some(account => account.archived) && <p className="finance-muted">Включает архивные счета.</p>}
    </section>
    <div className="finance-grid">
      {(['income', 'expense'] as const).map(kind => <section key={kind} className="finance-panel finance-stat" data-kind={kind}>
        <h2>{kind === 'income' ? 'Доходы за месяц' : 'Расходы за месяц'}</h2>
        <strong>{money(current[kind], currency)}</strong>
        <p className="finance-muted">Предыдущий месяц <b>{money(previous[kind], currency)}</b></p>
        <p className="finance-muted">Разница <b>{current[kind] > previous[kind] ? '+' : ''}{money(current[kind] - previous[kind], currency)}</b></p>
      </section>)}
      <section className="finance-panel">
        <h2>Динамика расходов</h2>
        {dates.length ? <ul className="finance-bars" aria-label="Расходы по дням">
          {dates.map(([date, amount]) => <li key={date}>
            <span>{date.slice(8)}.{date.slice(5, 7)}</span>
            <meter min={0} max={100} value={percentage(amount, peak)} aria-label={`Расходы ${date}`}>{percentage(amount, peak)}%</meter>
            <strong>{money(amount, currency)}</strong>
          </li>)}
        </ul> : <p className="finance-muted">В этом месяце расходов пока нет.</p>}
      </section>
      <section className="finance-panel">
        <h2>Расходы по категориям</h2>
        {categories.length ? <ul className="finance-bars" aria-label="Доли категорий">
          {categories.map(([label, amount]) => <li key={label}>
            <span>{label}</span>
            <meter min={0} max={100} value={percentage(amount, current.expense)} aria-label={label}>{percentage(amount, current.expense)}%</meter>
            <strong>{money(amount, currency)}</strong>
          </li>)}
        </ul> : <p className="finance-muted">Здесь появятся категории ваших расходов.</p>}
      </section>
    </div>
  </>
}
