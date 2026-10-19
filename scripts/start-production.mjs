import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function validateEnvironment(env) {
  for (const name of ['PORT', 'APP_ORIGIN', 'DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name}`)
  }
  const port = Number(env.PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 3001) {
    throw new Error('Invalid public PORT')
  }
  let origin, database
  try {
    origin = new URL(env.APP_ORIGIN)
    database = new URL(env.DATABASE_URL)
  } catch { throw new Error('Invalid APP_ORIGIN or DATABASE_URL') }
  if (origin.origin !== env.APP_ORIGIN || !['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('APP_ORIGIN must be an exact HTTP(S) origin')
  }
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw new Error('Public APP_ORIGIN requires HTTPS')
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || database.pathname.length < 2) {
    throw new Error('Invalid DATABASE_URL')
  }
  if (env.JWT_ACCESS_SECRET.length < 32 || env.JWT_REFRESH_SECRET.length < 32
    || env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) throw new Error('Invalid JWT secrets')
  if (env.API_INTERNAL_ORIGIN && env.API_INTERNAL_ORIGIN !== 'http://127.0.0.1:3001') {
    throw new Error('API_INTERNAL_ORIGIN must target internal Express')
  }
  return String(port)
}

// Dependencies are injectable so failure/signal paths can be tested without a DB.
export async function startProduction({ env = process.env, launch = spawn, probe = fetch,
  signals = process, shutdownMs = 15_000, readinessMs = 30_000 } = {}) {
  const port = validateEnvironment(env)
  const children = new Set()
  const controller = new AbortController()
  let stopping = false
  let exitCode = 0
  let finish
  const finished = new Promise((resolveFinished) => { finish = resolveFinished })
  function stop(code) {
    exitCode = Math.max(exitCode, code)
    if (stopping) return
    stopping = true
    controller.abort()
    for (const child of children) child.kill('SIGTERM')
    const timer = setTimeout(() => {
      exitCode = 1
      for (const child of children) child.kill('SIGKILL')
    }, shutdownMs)
    timer.unref()
    void Promise.all([...children].map((child) => child.completion)).then(() => {
      clearTimeout(timer)
      finish()
    })
  }
  const onSignal = () => stop(0)
  signals.on('SIGTERM', onSignal)
  signals.on('SIGINT', onSignal)
  function run(args, childEnv, persistent = false) {
    if (stopping) throw new Error('Startup cancelled')
    const child = launch(process.execPath, args, { stdio: 'inherit', env: childEnv })
    children.add(child)
    child.completion = new Promise((resolveChild) => {
      let completed = false
      function complete(code) {
        if (completed) return
        completed = true
        children.delete(child)
        if (stopping && code !== 0) exitCode = 1
        resolveChild(code)
        if (!stopping && (persistent || code !== 0)) stop(1)
      }
      child.once('error', () => complete(1))
      child.once('exit', (code, signal) => complete(code ?? (signal === 'SIGTERM' ? 0 : 1)))
    })
    return child
  }
  const serverEnv = { ...env, NODE_ENV: 'production', API_INTERNAL_ORIGIN: 'http://127.0.0.1:3001' }
  try {
    const migration = run(['dist-server/migrate-cli.js'], serverEnv)
    if (await migration.completion !== 0 || stopping) throw new Error('Migration failed or cancelled')
    run(['dist-server/index.js'], { ...serverEnv, PORT: '3001' }, true)
    const deadline = Date.now() + readinessMs
    let ready = false
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await probe('http://127.0.0.1:3001/api/health', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]),
        })
        ready = response.status === 200 && (await response.json()).status === 'ok'
      } catch { /* Retry only while the supervised API is starting. */ }
      if (ready) break
      await delay(100, undefined, { signal: controller.signal })
    }
    if (!ready || stopping) throw new Error('API readiness failed')
    const webEnv = { ...serverEnv }
    for (const key of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
      'TEST_DATABASE_URL', 'E2E_DATABASE_URL']) delete webEnv[key]
    run(['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', port], webEnv, true)
  } catch {
    if (!stopping) {
      console.error('Production startup failed. Check configuration, migrations and API readiness.')
      stop(1)
    }
  }
  await finished
  signals.off('SIGTERM', onSignal)
  signals.off('SIGINT', onSignal)
  return exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startProduction().then((code) => { process.exitCode = code }, () => {
    console.error('Invalid production configuration. Check required environment variables.')
    process.exitCode = 1
  })
}
