'use client'

import { useState } from 'react'
import { taskApi } from '../store/api'
import { requestMessage } from '../store/requestMessage'
import { accountKinds, currencies, entryKinds, financeBalances, goalProgress, money, monthSummary, percentage } from '../types/finance'
import type { Currency, FinanceAccount, FinanceSnapshot } from '../types/finance'
import { localDay } from '../types/planning'
import { ErrorState } from './ErrorState'
import { FinanceDashboard } from './FinanceDashboard'
import { FinanceEditor } from './FinanceEditor'
import type { FinanceEdit } from './FinanceEditor'

const sections = { overview: 'Обзор', entries: 'Операции', accounts: 'Счета', budgets: 'Бюджеты', goals: 'Цели' } as const

export function FinanceWorkspace() {
  const finance = taskApi.useFinanceQuery()
  return <section className="finance-workspace">
    <header className="finance-heading">
      <h1>Финансы</h1>
      <p>Счета, расходы и накопления в одном месте.</p>
    </header>
    {finance.isLoading && <p role="status">Загружаем финансы…</p>}
    {finance.isError && <ErrorState message="Не удалось загрузить финансы." retryLabel="Повторить" pending={finance.isFetching} onRetry={finance.refetch} />}
    {finance.data && <Ledger data={finance.data} />}
  </section>
}

function Ledger({ data }: { data: FinanceSnapshot }) {
  const [section, setSection] = useState<keyof typeof sections>('overview')
  const [edit, setEdit] = useState<FinanceEdit | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [remove, setRemove] = useState<{ resource: 'entries' | 'budgets'; id: string } | null>(null)
  const [accountFilter, setAccountFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [period, setPeriod] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [currency, setCurrency] = useState<Currency>('KGS')
  const today = localDay()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [write, state] = taskApi.useWriteFinanceMutation()
  const balances = financeBalances(data)
  const accounts = new Map(data.accounts.map(account => [account.id, account]))
  const active = data.accounts.filter(account => !account.archived)
  const categories = [...new Set(data.entries.flatMap(entry => entry.category ? [entry.category.toLocaleLowerCase('ru-RU')] : []))].sort()
  const budgetTotals = section === 'budgets' ? new Map(currencies.map(code => [code, monthSummary(data.entries, code, month).categories])) : null
  const search = query.trim().toLocaleLowerCase('ru-RU')
  const visible = data.entries.filter(entry =>
    (!accountFilter || entry.accountId === accountFilter || entry.destinationId === accountFilter) &&
    (!kindFilter || entry.kind === kindFilter) &&
    (!currencyFilter || entry.currency === currencyFilter) &&
    (!period || entry.day.startsWith(period + '-')) &&
    (!categoryFilter || entry.category?.toLocaleLowerCase('ru-RU') === categoryFilter) &&
    (!search || [entry.note, entry.category, accounts.get(entry.accountId)?.name, accounts.get(entry.destinationId ?? '')?.name]
      .some(value => value?.toLocaleLowerCase('ru-RU').includes(search))),
  )
  if (sort === 'oldest') visible.sort((a, b) => a.day.localeCompare(b.day))
  if (sort === 'amount') visible.sort((a, b) => a.currency.localeCompare(b.currency) ||
    (BigInt(a.amount) === BigInt(b.amount) ? 0 : BigInt(a.amount) > BigInt(b.amount) ? -1 : 1))

  function open(value: FinanceEdit) { setNotice(''); setError(''); setRemove(null); setEdit(value) }
  async function commit(resource: 'accounts' | 'entries' | 'budgets', id: string, body?: object) {
    if (state.isLoading) return
    setError('')
    try {
      await write({ resource, id, body, patch: resource === 'accounts' }).unwrap()
      setRemove(null)
      setNotice('Изменения сохранены.')
    } catch (failure) { setError(requestMessage(failure)) }
  }
  function archive({ id, archived }: FinanceAccount) {
    void commit('accounts', id, { archived: !archived })
  }
  function history(id: string) {
    setSection('entries')
    setAccountFilter(id)
    setPeriod('')
    setKindFilter('')
    setCurrencyFilter('')
    setCategoryFilter('')
    setQuery('')
  }
  const monthInput = <label>Месяц отчёта<input type="month" value={month}
    onChange={event => { if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value >= '0001-02') setMonth(event.target.value) }} /></label>

  return <>
    <div className="finance-tabs" role="group" aria-label="Разделы финансов">
      {Object.entries(sections).map(([key, label]) => <button key={key} type="button" aria-pressed={section === key}
        onClick={() => { setSection(key as keyof typeof sections); setRemove(null) }}>{label}</button>)}
    </div>
    {notice && <p className="finance-feedback" role="status">{notice}</p>}
    {error && <p className="work-error finance-feedback" role="alert">{error}</p>}
    {remove && <div className="finance-panel finance-toolbar" role="group" aria-label="Подтверждение удаления">
      <p>Удалить запись? Связанные остатки и прогресс пересчитаются.</p>
      <button type="button" className="add-button" disabled={state.isLoading} onClick={() => void commit(remove.resource, remove.id)}>Подтвердить удаление</button>
      <button type="button" disabled={state.isLoading} onClick={() => setRemove(null)}>Отмена</button>
    </div>}
    {section === 'overview' && <>
      <div className="finance-toolbar">
        {monthInput}
        <label>Валюта отчёта<select value={currency} onChange={event => setCurrency(event.target.value as Currency)}>
          {currencies.map(code => <option key={code}>{code}</option>)}
        </select></label>
        <button type="button" className="add-button" onClick={() => open({ resource: active.length ? 'entries' : 'accounts' })}>
          {active.length ? 'Добавить операцию' : 'Создать счёт'}
        </button>
      </div>
      <FinanceDashboard data={data} balances={balances} currency={currency} month={month} />
    </>}
    {section === 'accounts' && <>
      <div className="finance-toolbar"><h2>Счета</h2><button type="button" className="add-button"
        onClick={() => open({ resource: 'accounts' })}>Создать счёт</button></div>
      {!data.accounts.length && <p className="finance-panel finance-muted">Добавьте первый счёт, чтобы записывать операции.</p>}
      <div className="finance-grid">{data.accounts.map(account => <article className="finance-panel" key={account.id}>
        <p className="finance-muted">{accountKinds[account.kind]}{account.archived ? ' · Архив' : ''}</p>
        <h3>{account.name}</h3><strong className="finance-amount">{money(balances.get(account.id) ?? 0n, account.currency)}</strong>
        <p className="finance-muted">Начальный баланс {money(account.opening, account.currency)}</p>
        <div className="finance-actions">
          <button type="button" onClick={() => history(account.id)}>История</button>
          <button type="button" onClick={() => open({ resource: 'accounts', row: account })}>Изменить</button>
          <button type="button" disabled={state.isLoading} onClick={() => archive(account)}>{account.archived ? 'Восстановить' : 'В архив'}</button>
        </div>
      </article>)}</div>
    </>}
    {section === 'entries' && <section className="finance-panel">
      <div className="finance-toolbar"><h2>Операции</h2>
        <button type="button" className="add-button" disabled={!active.length} onClick={() => open({ resource: 'entries' })}>Добавить операцию</button>
        <button type="button" disabled={!active.some(a => active.some(b => a.id !== b.id && a.currency === b.currency))}
          onClick={() => open({ resource: 'entries', kind: 'transfer' })}>Перевести</button>
      </div>
      <div className="finance-toolbar finance-filters">
        <label>Поиск операций<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Описание, счёт, категория" /></label>
        <label>По счёту<select value={accountFilter} onChange={event => setAccountFilter(event.target.value)}>
          <option value="">Все счета</option>{data.accounts.map(account => <option value={account.id} key={account.id}>{account.name}</option>)}
        </select></label>
        <label>Тип<select value={kindFilter} onChange={event => setKindFilter(event.target.value)}>
          <option value="">Все операции</option>{Object.entries(entryKinds).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
        </select></label>
        <label>Категория<select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
          <option value="">Все категории</option>{categories.map(label => <option key={label}>{label}</option>)}
        </select></label>
        <label>Валюта<select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}>
          <option value="">Все валюты</option>{currencies.map(code => <option key={code}>{code}</option>)}
        </select></label>
        <label>Период<input type="month" value={period} onChange={event => setPeriod(event.target.value)} /></label>
        <label>Сортировка<select value={sort} onChange={event => setSort(event.target.value)}>
          <option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option>
          <option value="amount">По сумме внутри валюты</option>
        </select></label>
      </div>
      {!visible.length && <p className="finance-muted">{data.entries.length ? 'Операции по этим условиям не найдены.' : 'Здесь появятся ваши операции.'}</p>}
      <ul className="finance-records">{visible.map(entry => <li key={entry.id}>
        <div><strong>{entry.note || entry.category || (entry.goalId ? 'Взнос в цель' : 'Перевод')}</strong>
          <p className="finance-muted">{entry.day} · {entryKinds[entry.kind]} · {accounts.get(entry.accountId)?.name}
            {entry.destinationId && ' → ' + accounts.get(entry.destinationId)?.name}</p>
        </div>
        <strong className="finance-entry-amount" data-kind={entry.kind}>{entry.kind === 'income' ? '+' : entry.kind === 'expense' ? '−' : ''}{money(entry.amount, entry.currency)}</strong>
        <div className="finance-actions"><button type="button" onClick={() => open({ resource: 'entries', row: entry })}>Изменить</button>
          <button type="button" onClick={() => setRemove({ resource: 'entries', id: entry.id })}>Удалить</button></div>
      </li>)}</ul>
    </section>}
    {section === 'budgets' && <>
      <div className="finance-toolbar"><h2>Бюджеты</h2>{monthInput}<button type="button" className="add-button"
        onClick={() => open({ resource: 'budgets' })}>Добавить бюджет</button></div>
      {!data.budgets.some(budget => budget.month.startsWith(month + '-')) && <p className="finance-panel finance-muted">На этот месяц лимитов пока нет.</p>}
      <div className="finance-grid">{data.budgets.filter(budget => budget.month.startsWith(month + '-')).map(budget => {
        const spent = budgetTotals?.get(budget.currency)?.get(budget.category) ?? 0n
        const remaining = BigInt(budget.amount) - spent
        const progress = percentage(spent, BigInt(budget.amount))
        return <article className="finance-panel" key={budget.id}>
          <h3>{budget.category}</h3>
          <p>{money(spent, budget.currency)} из {money(budget.amount, budget.currency)}</p>
          <progress max={100} value={progress} aria-label={`Использовано по категории ${budget.category}`} />
          <p className={progress >= 80 ? 'finance-warning' : 'finance-muted'}>
            {remaining < 0n ? 'Лимит превышен на ' + money(-remaining, budget.currency) :
              progress === 100 ? 'Лимит исчерпан' : (progress >= 80 ? 'Близко к лимиту · осталось ' : 'Осталось ') + money(remaining, budget.currency)}
          </p>
          <div className="finance-actions"><button type="button" onClick={() => open({ resource: 'budgets', row: budget })}>Изменить</button>
            <button type="button" onClick={() => setRemove({ resource: 'budgets', id: budget.id })}>Удалить</button></div>
        </article>
      })}</div>
    </>}
    {section === 'goals' && <>
      <div className="finance-toolbar"><h2>Цели накопления</h2><button type="button" className="add-button" disabled={!active.length}
        onClick={() => open({ resource: 'goals' })}>Добавить цель</button></div>
      {!data.goals.length && <p className="finance-panel finance-muted">{active.length ? 'Создайте цель и выберите счёт для взносов.' : 'Сначала создайте счёт для накоплений.'}</p>}
      <div className="finance-grid">{data.goals.map(goal => {
        const saved = goalProgress(data.entries, goal.id)
        const enabled = !accounts.get(goal.accountId)?.archived && active.some(account => account.id !== goal.accountId && account.currency === goal.currency)
        return <article className="finance-panel" key={goal.id}>
          <h3>{goal.name}</h3>
          <p className="finance-muted">{accounts.get(goal.accountId)?.name}{goal.deadline ? ' · Срок ' + goal.deadline : ''}</p>
          <p>Внесено {money(saved, goal.currency)} из {money(goal.target, goal.currency)}</p>
          <progress max={100} value={percentage(saved, BigInt(goal.target))} aria-label={`Прогресс цели ${goal.name}`} />
          <p className="finance-muted">Остаток на счёте {money(balances.get(goal.accountId) ?? 0n, goal.currency)}</p>
          {!enabled && <p className="finance-muted">Для взноса нужны два активных счёта в одной валюте.</p>}
          <div className="finance-actions">
            <button type="button" className="add-button" disabled={!enabled} onClick={() => open({ resource: 'entries', kind: 'transfer', goal })}>Пополнить</button>
            <button type="button" onClick={() => open({ resource: 'goals', row: goal })}>Изменить</button>
          </div>
        </article>
      })}</div>
    </>}
    {edit && <FinanceEditor edit={edit} data={data} today={today} categories={categories}
      close={saved => { setEdit(null); if (saved) setNotice('Изменения сохранены.') }} />}
  </>
}
