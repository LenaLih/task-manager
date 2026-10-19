import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const configured = process.env.TEST_DATABASE_URL
function environment(database = configured) {
  if (!database) throw new Error('TEST_DATABASE_URL is required')
  const url = new URL(database)
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/task_manager_test') {
    throw new Error('Production smoke tests require local task_manager_test')
  }
  return { ...process.env, NODE_ENV: 'production', PORT: '3300',
    APP_ORIGIN: 'http://localhost:3300', DATABASE_URL: database,
    API_INTERNAL_ORIGIN: 'http://127.0.0.1:3001',
    JWT_ACCESS_SECRET: 'production-smoke-access-'.repeat(3),
    JWT_REFRESH_SECRET: 'production-smoke-refresh-'.repeat(3),
  }
}
function launch(env) {
  const child = spawn(process.execPath, ['scripts/start-production.mjs'], { env, stdio: 'inherit' })
  const exited = once(child, 'exit')
  return { child, exited }
}

test('production startup rejects unreachable PostgreSQL before opening HTTP', { timeout: 20_000 }, async () => {
  const url = new URL(environment().DATABASE_URL)
  url.port = '1'
  const { exited } = launch(environment(url.toString()))
  assert.notEqual((await exited)[0], 0)
})

test('real production Next rewrite forwards Origin, cookies and private API responses', { timeout: 90_000 }, async () => {
  const { child, exited } = launch(environment())
  try {
    let ready = false
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error('Launcher exited before readiness')
      try {
        const response = await fetch('http://localhost:3300/api/health')
        ready = response.ok && (await response.json()).status === 'ok'
      } catch { /* Server still starting. */ }
      if (ready) break
      await delay(200)
    }
    assert.ok(ready)
    const post = (path, body, cookie, origin = 'http://localhost:3300') => fetch(`http://localhost:3300/api/auth/${path}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    })
    const credentials = { email: `smoke-${randomUUID()}@example.com`, password: 'smoke-password-123' }
    assert.equal((await post('register', credentials, undefined, 'https://evil.example')).status, 403)
    const registration = await post('register', credentials)
    assert.equal(registration.status, 201)
    assert.equal(registration.headers.get('cache-control'), 'no-store')
    const cookie = registration.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /Secure/i)
    assert.match(cookie, /SameSite=Strict/i)
    assert.match(cookie, /Path=\/api\/auth/i)
    const refreshed = await post('refresh', {}, cookie.split(';')[0])
    assert.equal(refreshed.status, 200)
    const session = await refreshed.json()
    const tasks = await fetch('http://localhost:3300/api/tasks', { headers: { Authorization: `Bearer ${session.accessToken}` } })
    assert.equal(tasks.status, 200)
    assert.deepEqual(await tasks.json(), [])
    assert.equal(tasks.headers.get('cache-control'), 'no-store')
    assert.equal((await post('logout', {}, refreshed.headers.get('set-cookie').split(';')[0])).status, 204)
  } finally {
    // Windows kill does not deliver POSIX signals; real graceful shutdown is checked on Linux CI.
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      await once(killer, 'exit')
    } else child.kill('SIGTERM')
    const [code, signal] = await exited
    console.log(`[production smoke] launcher terminated; platform=${process.platform}; code=${code}; signal=${signal ?? 'none'}`)
    if (process.platform !== 'win32') {
      assert.equal(code, 0, `Graceful launcher shutdown failed (signal=${signal ?? 'none'}); inspect production child exit diagnostics`)
      assert.equal(signal, null)
    }
  }
})
