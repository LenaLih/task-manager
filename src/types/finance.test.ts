import { expect, it } from 'vitest'
import { financeBalances, goalProgress, minorUnits, money, monthSummary, percentage } from './finance'
import type { FinanceEntry, FinanceSnapshot } from './finance'

it('parses and formats exact amounts without floating-point rounding', () => {
  expect(minorUnits('100,01')).toBe('10001')
  expect(minorUnits('-0,01', true)).toBe('-1')
  expect(() => minorUnits('1,999')).toThrow()
  expect(() => minorUnits('0')).toThrow()
  expect(money('-1', 'USD')).toMatch(/-0,01/u)
  expect(money('900719925474099301', 'KGS').replace(/\s/gu, '')).toContain('9007199254740993,01')
})

it('counts contributions once and excludes transfers and other currencies from the budget', () => {
  const entry = { accountId: 'wallet', destinationId: null, goalId: null, currency: 'KGS',
    day: '2026-11-05', amount: '899', note: '', category: 'Еда' } as const
  const entries: FinanceEntry[] = [
    { ...entry, id: 'income', kind: 'income', amount: '2502' },
    { ...entry, id: 'expense', kind: 'expense' },
    { ...entry, id: 'other', kind: 'expense', currency: 'USD', accountId: 'dollars' },
    { ...entry, id: 'last-month', kind: 'expense', day: '2026-10-31', amount: '50' },
    { ...entry, id: 'transfer', kind: 'transfer', category: null, amount: '701', destinationId: 'savings', goalId: 'goal' },
  ]
  const data: FinanceSnapshot = {
    accounts: [
      { id: 'wallet', name: 'Cash', kind: 'cash', currency: 'KGS', opening: '1000', archived: false },
      { id: 'savings', name: 'Saving', kind: 'savings', currency: 'KGS', opening: '0', archived: false },
      { id: 'dollars', name: 'USD', kind: 'bank', currency: 'USD', opening: '1200', archived: false },
    ],
    entries, budgets: [], goals: [],
  }
  expect(financeBalances(data)).toEqual(new Map([['wallet', 1852n], ['savings', 701n], ['dollars', 301n]]))
  const summary = monthSummary(entries, 'KGS', '2026-11')
  expect(summary).toMatchObject({ income: 2502n, expense: 899n, categories: new Map([['еда', 899n]]) })
  expect(monthSummary(entries, 'KGS', '2026-10').expense).toBe(50n)
  expect(goalProgress(entries, 'goal')).toBe(701n)
  expect(percentage(899n, 1000n)).toBe(89)
  expect(percentage(1001n, 1000n)).toBe(100)
})
