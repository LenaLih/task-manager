import 'dotenv/config'
import { createPostgresPool } from './db.js'
import { runMigrations } from './migrate.js'

async function main(): Promise<void> {
  const pool = createPostgresPool()

  try {
    const executed = await runMigrations(pool)
    console.log(executed.length ? `Applied: ${executed.join(', ')}` : 'Database is up to date')
  } finally {
    await pool.end()
  }
}

main().catch(() => {
  // Avoid printing errors that might expose credentials or database contents.
  console.error('PostgreSQL migration failed. Check DATABASE_URL, connectivity and migration files.')
  process.exitCode = 1
})
