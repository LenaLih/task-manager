import type { Pool } from 'pg'
import { expect, it, vi } from 'vitest'
import { withTransaction } from './db'

it('surfaces rollback failure instead of misclassifying it as an auth failure', async () => {
  const databaseError = new Error('Connection lost during rollback')
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === 'ROLLBACK') throw databaseError
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool

  await expect(withTransaction(pool, async () => {
    throw new Error('Invalid session')
  })).rejects.toBe(databaseError)
  expect(client.release).toHaveBeenCalledExactlyOnceWith(true)
})
