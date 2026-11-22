export const currencies = ['KGS', 'RUB', 'USD'] as const
export const accountKinds = { cash: 'Наличные', bank: 'Банковский счёт', card: 'Карта', savings: 'Накопления' } as const
export const entryKinds = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' } as const
export type Currency = typeof currencies[number]
export type FinanceAccount = { id: string; name: string; kind: keyof typeof accountKinds; currency: Currency; opening: string; archived: boolean }
export type FinanceEntry = {
  id: string; accountId: string; destinationId: string | null; goalId: string | null; kind: keyof typeof entryKinds;
  currency: Currency; amount: string; day: string; category: string | null; note: string
}
export type FinanceBudget = { id: string; category: string; currency: Currency; month: string; amount: string }
export type FinanceGoal = { id: string; name: string; accountId: string; currency: Currency; target: string; deadline: string | null }
export type FinanceSnapshot = { accounts: FinanceAccount[]; entries: FinanceEntry[]; budgets: FinanceBudget[]; goals: FinanceGoal[] }

export function minorUnits(input: string, signed = false) {
  const match = /^(-?)(\d{1,13})(?:[.,](\d{1,2}))?$/.exec(input.trim())
  if (!match || (!signed && match[1])) throw Error('Введите сумму с точностью до двух знаков после запятой.')
  const units = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))
  if (!signed && !units) throw Error('Сумма должна быть больше нуля.')
  return (match[1] ? -units : units).toString()
}

export function editableAmount(amount: string) {
  const units = BigInt(amount)
  const absolute = units < 0n ? -units : units
  return (units < 0n ? '-' : '') + absolute / 100n + '.' + String(absolute % 100n).padStart(2, '0')
}

export function money(units: bigint | string, currency: Currency) {
  const value = BigInt(units)
  const absolute = value < 0n ? -value : value
  const whole = value < 0n ? (absolute < 100n ? -0 : -absolute / 100n) : absolute / 100n
  const formatter = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, currencyDisplay: 'code' })
  return formatter.formatToParts(whole).map(part =>
    part.type === 'fraction' ? String(absolute % 100n).padStart(2, '0') : part.value).join('')
}

export function financeBalances(data: FinanceSnapshot) {
  const totals = new Map(data.accounts.map(account => [account.id, BigInt(account.opening)]))
  for (const entry of data.entries) {
    const amount = BigInt(entry.amount)
    totals.set(entry.accountId, (totals.get(entry.accountId) ?? 0n) + (entry.kind === 'income' ? amount : -amount))
    if (entry.destinationId) totals.set(entry.destinationId, (totals.get(entry.destinationId) ?? 0n) + amount)
  }
  return totals
}

export function currencyBalances(accounts: FinanceAccount[], balances: ReadonlyMap<string, bigint>) {
  return currencies.map(code => ({
    code,
    total: accounts.filter(account => account.currency === code)
      .reduce((sum, account) => sum + (balances.get(account.id) ?? 0n), 0n),
  }))
}

export function monthSummary(entries: FinanceEntry[], currency: Currency, month: string) {
  let income = 0n
  let expense = 0n
  const categories = new Map<string, bigint>()
  const days = new Map<string, bigint>()
  for (const entry of entries) {
    if (entry.currency !== currency || !entry.day.startsWith(month + '-')) continue
    const amount = BigInt(entry.amount)
    if (entry.kind === 'income') income += amount
    if (entry.kind === 'expense') {
      expense += amount
      const label = entry.category!.toLocaleLowerCase('ru-RU')
      categories.set(label, (categories.get(label) ?? 0n) + amount)
      days.set(entry.day, (days.get(entry.day) ?? 0n) + amount)
    }
  }
  return { income, expense, categories, days }
}

export function goalProgress(entries: FinanceEntry[], goalId: string) {
  return entries.reduce((sum, entry) => entry.goalId === goalId ? sum + BigInt(entry.amount) : sum, 0n)
}

export function percentage(amount: bigint, target: bigint) {
  return target <= 0n ? 0 : Number(amount >= target ? 100n : (amount * 100n) / target)
}
