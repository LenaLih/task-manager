import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import type { Pool } from 'pg'

type AppliedMigration = {
  name: string
  checksum: string
}

const migrationsDirectory = new URL('../migrations/', import.meta.url)

/** All pending migrations and their journal entries commit atomically. */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && /^\d+_[a-z0-9_]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  if (!names.length) throw new Error('No SQL migrations found')

  const migrations = await Promise.all(names.map(async (name) => {
    // Normalization makes checksums stable across Windows/Linux Git checkouts.
    const sql = (await readFile(new URL(name, migrationsDirectory), 'utf8'))
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
    const checksum = createHash('sha256').update(sql).digest('hex')
    return { name, sql, checksum }
  }))

  const client = await pool.connect()
  let transactionStarted = false
  let released = false

  try {
    await client.query('BEGIN')
    transactionStarted = true
    await client.query("SET LOCAL lock_timeout = '15s'")
    await client.query("SET LOCAL statement_timeout = '120s'")
    // A fixed, application-specific transaction lock serializes migration runners.
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [1937006961, 1])
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const { rows: applied } = await client.query<AppliedMigration>(
      'SELECT name, checksum FROM public.schema_migrations ORDER BY name',
    )
    const byName = new Map(migrations.map((migration) => [migration.name, migration]))

    for (const migration of applied) {
      if (byName.get(migration.name)?.checksum !== migration.checksum) {
        throw new Error(`Applied migration is missing or modified: ${migration.name}`)
      }
    }

    const appliedNames = new Set(applied.map((migration) => migration.name))
    const latestApplied = applied.at(-1)?.name
    const executed: string[] = []

    for (const migration of migrations) {
      if (appliedNames.has(migration.name)) continue
      if (latestApplied && migration.name < latestApplied) {
        throw new Error(`Migration is out of order: ${migration.name}`)
      }

      await client.query(migration.sql)
      await client.query(
        'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
        [migration.name, migration.checksum],
      )
      executed.push(migration.name)
    }

    await client.query('COMMIT')
    transactionStarted = false
    return executed
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Discard an unusable connection instead of returning it to the pool.
        client.release(true)
        released = true
        throw error
      }
    }
    throw error
  } finally {
    // release() must be called only once, even when rollback fails.
    if (!released) client.release()
  }
}
