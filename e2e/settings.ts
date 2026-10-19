import 'dotenv/config'

export const webOrigin = 'http://localhost:3200'
export const apiOrigin = 'http://127.0.0.1:3201'

function parseDatabaseUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error('Invalid database URL: check E2E configuration')
  }
}

export function getE2eDatabaseUrl(): string {
  const mainUrl = process.env.DATABASE_URL
  const configured = process.env.E2E_DATABASE_URL?.trim() || undefined
  if (!configured && !mainUrl) throw new Error('Set a local E2E_DATABASE_URL')
  const url = parseDatabaseUrl(configured ?? mainUrl!)
  if (!configured) url.pathname = '/task_manager_e2e'
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    decodeURIComponent(url.pathname.slice(1)) !== 'task_manager_e2e'
  ) throw new Error('E2E requires local PostgreSQL database task_manager_e2e')
  if (mainUrl && decodeURIComponent(parseDatabaseUrl(mainUrl).pathname.slice(1)) === 'task_manager_e2e') {
    throw new Error('Application DATABASE_URL must not point to the E2E database')
  }
  if (process.env.NODE_ENV === 'production') throw new Error('E2E refuses a production environment')
  return url.toString()
}
