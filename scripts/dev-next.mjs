import 'dotenv/config'
import { spawn } from 'node:child_process'

// Explicit ports prevent the existing .env PORT=3001 from moving Next onto the API port.
const webPort = process.env.NEXT_PORT ?? '3000'
const apiPort = process.env.API_PORT ?? '3001'
const origin = process.env.NEXT_APP_ORIGIN ?? `http://localhost:${webPort}`
if (webPort === apiPort) throw new Error('Next.js and Express must use different ports')

const web = spawn(process.execPath, [
  'node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', webPort,
], {
  stdio: 'inherit',
  env: { ...process.env, API_PORT: apiPort, API_INTERNAL_ORIGIN: process.env.API_INTERNAL_ORIGIN ?? `http://127.0.0.1:${apiPort}` },
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
