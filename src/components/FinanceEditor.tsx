import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { taskApi } from '../store/api'
import { requestMessage } from '../store/requestMessage'
import { accountKinds, currencies, editableAmount, entryKinds, minorUnits } from '../types/finance'
import type { FinanceAccount, FinanceBudget, FinanceEntry, FinanceGoal, FinanceSnapshot } from '../types/finance'

export type FinanceEdit =
  | { resource: 'accounts'; row?: FinanceAccount }
  | { resource: 'entries'; row?: FinanceEntry; kind?: FinanceEntry['kind']; goal?: FinanceGoal }
  | { resource: 'budgets'; row?: FinanceBudget }
  | { resource: 'goals'; row?: FinanceGoal }

const titles = { accounts: 'Счёт', entries: 'Операция', budgets: 'Бюджет', goals: 'Финансовая цель' }

export function FinanceEditor({ edit, data, today, categories, close }: {
  edit: FinanceEdit; data: FinanceSnapshot; today: string; categories: string[]; close: (saved?: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const waiting = useRef(false)
  const [id] = useState(() => edit.row?.id ?? crypto.randomUUID())
  const [error, setError] = useState('')
  const [write, state] = taskApi.useWriteFinanceMutation()
  const entry = edit.resource === 'entries' ? edit.row : undefined
  const contribution = edit.resource === 'entries' ? edit.goal ?? data.goals.find(goal => goal.id === entry?.goalId) : undefined
  const [kind, setKind] = useState(entry?.kind ?? (edit.resource === 'entries' ? edit.kind : undefined) ?? 'expense')
  const goalAccount = data.accounts.find(account => account.id === contribution?.accountId)
  const available = data.accounts.filter(account => (
    (!account.archived || account.id === entry?.accountId) &&
    (!goalAccount || (account.currency === goalAccount.currency && account.id !== goalAccount.id))
  ))
  const [source, setSource] = useState(entry?.accountId ?? available[0]?.id ?? '')
  const selected = data.accounts.find(account => account.id === source)
  const destinations = data.accounts.filter(account => account.id !== source && account.currency === selected?.currency &&
    (!account.archived || account.id === entry?.destinationId))

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (waiting.current) return
    const values = new FormData(event.currentTarget)
    const field = (key: string) => String(values.get(key) ?? '')
    waiting.current = true
    setError('')
    try {
      let body: object
      if (edit.resource === 'accounts') {
        body = { name: field('name'), kind: field('kind'), currency: edit.row?.currency ?? field('currency'),
          opening: minorUnits(field('opening'), true) }
      } else if (edit.resource === 'budgets') {
        body = { category: field('category'), currency: field('currency'), month: field('month') + '-01',
          amount: minorUnits(field('amount')) }
      } else if (edit.resource === 'goals') {
        body = { name: field('name'), accountId: edit.row?.accountId ?? field('accountId'),
          target: minorUnits(field('target')), deadline: field('deadline') || null }
      } else {
        body = { accountId: source, kind, amount: minorUnits(field('amount')), day: field('day'), note: field('note'),
          ...(kind === 'transfer' ? { destinationId: contribution?.accountId ?? field('destinationId'),
            ...(contribution ? { goalId: contribution.id } : {}) } : { category: field('category') }) }
      }
      await write({ resource: edit.resource, id, body }).unwrap()
      close(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : requestMessage(failure))
    } finally {
      waiting.current = false
    }
  }

  const category = (value?: string | null) => <label>Категория<input name="category" required maxLength={80}
    list="finance-categories" defaultValue={value ?? ''} /></label>
  const currency = (value?: string, fixed = false) => <label>Валюта<select name="currency" disabled={fixed} defaultValue={value ?? 'KGS'}>
    {currencies.map(item => <option key={item}>{item}</option>)}
  </select></label>
  const title = contribution ? 'Взнос в цель' : (edit.row ? 'Редактирование · ' : 'Новая запись · ') + titles[edit.resource]

  return <dialog ref={dialog} className="work-dialog finance-editor" aria-labelledby="finance-editor-title"
    onCancel={event => { event.preventDefault(); if (!waiting.current) close() }}>
    <form onSubmit={submit} aria-busy={state.isLoading}>
      <h2 id="finance-editor-title">{title}</h2>
      <fieldset disabled={state.isLoading}>
        {edit.resource === 'accounts' && <>
          <label>Название<input name="name" maxLength={80} required defaultValue={edit.row?.name} /></label>
          <label>Тип счёта<select name="kind" defaultValue={edit.row?.kind ?? 'cash'}>
            {Object.entries(accountKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          {currency(edit.row?.currency, !!edit.row)}
          <label>Начальный баланс<input name="opening" inputMode="decimal" required defaultValue={editableAmount(edit.row?.opening ?? '0')} /></label>
        </>}
        {edit.resource === 'entries' && <>
          {contribution ? <p>{contribution.name} · {goalAccount?.name}</p> : <label>Тип операции<select
            value={kind} onChange={event => setKind(event.target.value as FinanceEntry['kind'])}>
            {Object.entries(entryKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>}
          <label>{kind === 'transfer' ? 'Со счёта' : 'Счёт'}<select value={source} required onChange={event => setSource(event.target.value)}>
            <option value="" disabled>Выберите счёт</option>
            {available.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
          </select></label>
          {kind === 'transfer' && !contribution && <label>На счёт<select key={source} name="destinationId"
            defaultValue={destinations.some(item => item.id === entry?.destinationId) ? entry?.destinationId ?? '' : ''} required>
            <option value="" disabled>Выберите счёт в той же валюте</option>
            {destinations.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></label>}
          {kind !== 'transfer' && category(entry?.category)}
          <label>Сумма{selected ? ' · ' + selected.currency : ''}<input name="amount" inputMode="decimal" required
            defaultValue={entry ? editableAmount(entry.amount) : ''} /></label>
          <label>Дата<input name="day" type="date" required defaultValue={entry?.day ?? today} /></label>
          <label>Описание<textarea name="note" rows={2} maxLength={500} defaultValue={entry?.note} /></label>
        </>}
        {edit.resource === 'budgets' && <>
          {category(edit.row?.category)}
          {currency(edit.row?.currency)}
          <label>Месяц<input type="month" name="month" required defaultValue={edit.row?.month.slice(0, 7) ?? today.slice(0, 7)} /></label>
          <label>Лимит<input name="amount" inputMode="decimal" required defaultValue={edit.row ? editableAmount(edit.row.amount) : ''} /></label>
        </>}
        {edit.resource === 'goals' && <>
          <label>Название<input name="name" maxLength={80} required defaultValue={edit.row?.name} /></label>
          <label>Счёт накоплений<select name="accountId" required disabled={!!edit.row} defaultValue={edit.row?.accountId ?? ''}>
            <option value="" disabled>Выберите счёт</option>
            {data.accounts.filter(account => !account.archived || account.id === edit.row?.accountId)
              .map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
          </select></label>
          <label>Целевая сумма<input name="target" inputMode="decimal" required defaultValue={edit.row ? editableAmount(edit.row.target) : ''} /></label>
          <label>Срок<input name="deadline" type="date" defaultValue={edit.row?.deadline ?? ''} /></label>
        </>}
      </fieldset>
      <datalist id="finance-categories">{categories.map(label => <option key={label} value={label} />)}</datalist>
      {error && <p className="work-error" role="alert">{error}</p>}
      <div className="work-dialog-actions">
        <button type="button" disabled={state.isLoading} onClick={() => close()}>Отмена</button>
        <button className="add-button" type="submit" disabled={state.isLoading}>{state.isLoading ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </form>
  </dialog>
}
