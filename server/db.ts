import { Pool } from 'pg'
import type { PoolClient } from 'pg'

/** Creates a separate pool only when PostgreSQL is explicitly requested. */
export function createPostgresPool(
  connectionString: string | undefined = process.env.DATABASE_URL,
): Pool {
  if (!connectionString?.trim()) {
    throw new Error('DATABASE_URL is required for PostgreSQL operations')
  }

  let databaseUrl: URL
  try {
    databaseUrl = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL')
  }

  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !databaseUrl.hostname ||
    databaseUrl.pathname.length <= 1
  ) {
    throw new Error('DATABASE_URL must specify a PostgreSQL host and database')
  }

  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
  })

  // Do not log connection strings, passwords or server error details.
  pool.on('error', () => {
    console.error('Unexpected PostgreSQL idle connection error')
  })

  // TLS is configured in DATABASE_URL. No global certificate-verification bypass.
  return pool
}

/** Run a transaction on one checked-out connection, including rollback on failure. */
export async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let discard = false
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      discard = true
      throw rollbackError
    }
    throw error
  } finally {
    client.release(discard)
  }
}
