import { createPostgresPool } from '../server/db.js'
import { runMigrations } from '../server/migrate.js'
import { getE2eDatabaseUrl } from './settings.js'

export async function prepareDatabase() {
  const pool = createPostgresPool(getE2eDatabaseUrl())
  try {
    const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name')
    if (rows[0]?.name !== 'task_manager_e2e') throw new Error('Unexpected E2E database')
    await runMigrations(pool)
    console.log('Isolation verified: task_manager_e2e; migrations ready; no data cleanup')
    return pool
  } catch (error) {
    await pool.end()
    throw error
  }
}
