import 'dotenv/config'
import { createApp } from './app.js'
import { createPostgresPool } from './db.js'

async function main(): Promise<void> {
  const pool = createPostgresPool()
  try {
    const { app } = createApp({
      accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
      origin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
      production: process.env.NODE_ENV === 'production',
    }, pool)
    await pool.query('SELECT 1')
    const server = app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1', () => {
      console.log('PostgreSQL API listening')
    })
    let stopping = false
    function shutdown(code = 0): void {
      if (stopping) return
      stopping = true
      const timeout = setTimeout(() => process.exit(1), 10_000)
      timeout.unref()
      server.close(() => {
        void pool.end().then(() => {
          clearTimeout(timeout)
          process.exit(code)
        }, () => process.exit(1))
      })
    }
    server.on('error', () => {
      console.error('API listener failed')
      shutdown(1)
    })
    process.on('SIGTERM', () => shutdown())
    process.on('SIGINT', () => shutdown())
  } catch (error) {
    await pool.end()
    throw error
  }
}

main().catch(() => {
  console.error('API startup failed. Check DATABASE_URL, PostgreSQL and JWT configuration.')
  process.exitCode = 1
})
