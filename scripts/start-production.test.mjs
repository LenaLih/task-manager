import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { startProduction, validateEnvironment } from './start-production.mjs'

const env = {
  PORT: '3300', APP_ORIGIN: 'http://localhost:3300',
  DATABASE_URL: 'postgresql://test:password@localhost/task_manager_test',
  JWT_ACCESS_SECRET: 'a'.repeat(48), JWT_REFRESH_SECRET: 'b'.repeat(48),
}
function harness({ migrationCode = 0, ready = true } = {}) {
  const signals = new EventEmitter()
  const calls = []
  let webStarted
  const web = new Promise((resolve) => { webStarted = resolve })
  const launch = (_node, args, options) => {
    const child = new EventEmitter()
    child.kill = (signal) => {
      child.signal = signal
      queueMicrotask(() => child.emit('exit', 0))
      return true
    }
    calls.push({ args, options, child })
    if (args[0].includes('migrate')) queueMicrotask(() => child.emit('exit', migrationCode))
    if (args.includes('start')) webStarted()
    return child
  }
  const result = startProduction({ env, launch, signals, readinessMs: 10,
    probe: async () => ({ status: ready ? 200 : 503, json: async () => ({ status: 'ok' }) }),
  })
  return { calls, signals, result, web }
}

test('validates configuration without exposing secret values', () => {
  for (const key of Object.keys(env)) {
    assert.throws(() => validateEnvironment({ ...env, [key]: '' }))
  }
  assert.throws(() => validateEnvironment({ ...env, PORT: '3001' }))
  assert.throws(() => validateEnvironment({ ...env, JWT_REFRESH_SECRET: env.JWT_ACCESS_SECRET }))
})

test('runs migrations, waits for API and starts public Next without DB/JWT secrets', async () => {
  const h = harness()
  await h.web
  assert.equal(h.calls.length, 3)
  assert.equal(h.calls[1].options.env.PORT, '3001')
  assert.deepEqual(h.calls[2].args.slice(-4), ['--hostname', '0.0.0.0', '--port', '3300'])
  assert.equal(h.calls[2].options.env.DATABASE_URL, undefined)
  assert.equal(h.calls[2].options.env.JWT_ACCESS_SECRET, undefined)
  h.signals.emit('SIGTERM')
  assert.equal(await h.result, 0)
  assert.equal(h.calls[1].child.signal, 'SIGTERM')
  assert.equal(h.calls[2].child.signal, 'SIGTERM')
})

test('migration failure blocks both servers', async () => {
  const h = harness({ migrationCode: 1 })
  assert.equal(await h.result, 1)
  assert.equal(h.calls.length, 1)
})

test('API readiness failure prevents Next startup and stops API', async () => {
  const h = harness({ ready: false })
  assert.equal(await h.result, 1)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].child.signal, 'SIGTERM')
})

for (const index of [1, 2]) {
  test(`unexpected server ${index} exit stops sibling even with exit code zero`, async () => {
    const h = harness()
    await h.web
    h.calls[index].child.emit('exit', 0)
    assert.equal(await h.result, 1)
    assert.equal(h.calls[index === 1 ? 2 : 1].child.signal, 'SIGTERM')
  })
}

test('SIGINT during migration cancels startup and waits for child', async () => {
  const signals = new EventEmitter()
  const child = new EventEmitter()
  child.kill = () => { queueMicrotask(() => child.emit('exit', null, 'SIGTERM')); return true }
  const result = startProduction({ env, signals, launch: () => child })
  signals.emit('SIGINT')
  assert.equal(await result, 0)
})

test('spawn error fails startup without leaving a supervised server running', async () => {
  const child = new EventEmitter()
  child.kill = () => true
  const result = startProduction({ env, signals: new EventEmitter(), launch: () => {
    queueMicrotask(() => child.emit('error', new Error('spawn failed')))
    return child
  } })
  assert.equal(await result, 1)
})

test('shutdown escalates a stuck child to SIGKILL and reports failure', async () => {
  const child = new EventEmitter()
  const signals = new EventEmitter()
  const received = []
  child.kill = (signal) => {
    received.push(signal)
    if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null))
    return true
  }
  // Keep the event loop alive, as real subprocess handles would.
  const alive = setInterval(() => {}, 100)
  try {
    const result = startProduction({ env, signals, shutdownMs: 5, launch: () => child })
    signals.emit('SIGTERM')
    assert.equal(await result, 1)
    assert.deepEqual(received, ['SIGTERM', 'SIGKILL'])
  } finally { clearInterval(alive) }
})
