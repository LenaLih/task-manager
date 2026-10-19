import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { runMigrations } from './migrate'

type AppliedMigration = { name: string; checksum: string }

function createTestPool(applied: AppliedMigration[] = [], failMigration = false) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (failMigration && sql.includes('CREATE TABLE public.users')) {
      throw new Error('DDL failed')
    }
    return { rows: sql.includes('SELECT name, checksum') ? applied : [] }
  })
  const release = vi.fn()
  const client = { query, release }
  const connect = vi.fn(async () => client)
  return { pool: { connect } as unknown as Pool, query, release, connect }
}

describe('PostgreSQL migration runner', () => {
  it('runs DDL and records the migration on one locked transaction', async () => {
    const { pool, query, release, connect } = createTestPool()

    await expect(runMigrations(pool)).resolves.toEqual(['001_initial.sql'])

    expect(connect).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toBe('BEGIN')
    const lockIndex = query.mock.calls.findIndex(([sql]) => sql.includes('pg_advisory_xact_lock'))
    const ddlIndex = query.mock.calls.findIndex(([sql]) => sql.includes('CREATE TABLE public.users'))
    expect(lockIndex).toBeGreaterThan(0)
    expect(ddlIndex).toBeGreaterThan(lockIndex)
    expect(query).toHaveBeenCalledWith(
      'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
      ['001_initial.sql', expect.stringMatching(/^[a-f0-9]{64}$/)],
    )
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('skips an already applied migration without repeating DDL', async () => {
    const sql = (await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'))
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const { pool, query } = createTestPool([{ name: '001_initial.sql', checksum }])

    await expect(runMigrations(pool)).resolves.toEqual([])
    expect(query.mock.calls.some(([sql]) => sql.includes('CREATE TABLE public.users'))).toBe(false)
  })

  it('rejects a modified migration and rolls back', async () => {
    const { pool, query, release } = createTestPool([
      { name: '001_initial.sql', checksum: 'changed' },
    ])

    await expect(runMigrations(pool)).rejects.toThrow('missing or modified')
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(query).not.toHaveBeenCalledWith('COMMIT')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('rolls back DDL failures without recording a successful migration', async () => {
    const { pool, query, release } = createTestPool([], true)

    await expect(runMigrations(pool)).rejects.toThrow('DDL failed')
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(query).not.toHaveBeenCalledWith('COMMIT')
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO'))).toBe(false)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('discards the connection once when rollback also fails', async () => {
    const { pool, query, release } = createTestPool([], true)
    const originalQuery = query.getMockImplementation()!
    query.mockImplementation(async (sql, values) => {
      if (sql === 'ROLLBACK') throw new Error('Connection lost')
      return originalQuery(sql, values)
    })

    await expect(runMigrations(pool)).rejects.toThrow('DDL failed')
    expect(release).toHaveBeenCalledExactlyOnceWith(true)
  })
})
