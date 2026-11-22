import 'dotenv/config'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

function readPort(name, fallback) {
  const value = process.env[name] ?? fallback
  const port = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number between 1 and 65535`)
  }
  return port
}

function checkPort(port, service) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (error) => {
      const address = `127.0.0.1:${port}`
      reject(new Error(error.code === 'EADDRINUSE'
        ? `${service} port ${address} is already in use. Check for an existing development server.`
        : `Cannot bind ${service} to ${address} (${error.code}).`))
    })
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close((error) => error ? reject(error) : resolve())
    })
  })
}

// Explicit ports prevent the existing .env PORT=3001 from moving Next onto the API port.
const webPort = readPort('NEXT_PORT', '3000')
const apiPort = readPort('API_PORT', '3001')
const origin = process.env.NEXT_APP_ORIGIN ?? `http://localhost:${webPort}`
if (webPort === apiPort) throw new Error('Next.js and Express must use different ports')

try {
  await Promise.all([checkPort(webPort, 'Next.js'), checkPort(apiPort, 'Express')])
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const web = spawn(process.execPath, [
  'node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(webPort),
], {
  stdio: 'inherit',
  env: {
    ...process.env, MAILJET_API_KEY: '', MAILJET_SECRET_KEY: '',
    API_PORT: apiPort, API_INTERNAL_ORIGIN: process.env.API_INTERNAL_ORIGIN ?? `http://127.0.0.1:${apiPort}`,
  },
})
const api = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: apiPort, APP_ORIGIN: origin },
})
const children = [web, api]
let stopping = false

function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) child.kill('SIGTERM')
  const timeout = setTimeout(() => process.exit(code || 1), 10_000)
  timeout.unref()
}

for (const child of children) {
  child.on('error', () => shutdown(1))
  child.on('exit', (code) => shutdown(code ?? 1))
}
process.on('SIGTERM', () => shutdown())
process.on('SIGINT', () => shutdown())
