import { describe, expect, it } from 'vitest'
import { addDays, calendarDays, localDay, shiftCalendar, weeklyActivity } from './planning'

describe('calendar dates', () => {
  it('starts on Monday and preserves civil dates across leap day and DST changes', () => {
    expect(calendarDays('2024-02-29', 'month').slice(0, 2)).toEqual(['2024-01-29', '2024-01-30'])
    expect(calendarDays('2024-03-31', 'week')).toEqual([
      '2024-03-25', '2024-03-26', '2024-03-27', '2024-03-28', '2024-03-29', '2024-03-30', '2024-03-31',
    ])
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftCalendar('2024-01-31', 'month', 1)).toBe('2024-02-01')
    expect(localDay(new Date(2024, 2, 31, 23, 59))).toBe('2024-03-31')
  })

  it('groups daily activity into Monday-based weeks without counting adjacent days twice', () => {
    expect(weeklyActivity([
      { date: '2024-12-29', created: 1, completed: 0 },
      { date: '2024-12-30', created: 2, completed: 3 },
      { date: '2025-01-01', created: 0, completed: 1 },
    ])).toEqual([
      { date: '2024-12-23', created: 1, completed: 0 },
      { date: '2024-12-30', created: 2, completed: 4 },
    ])
  })
})
