import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { prepareDatabase } from './database.js'
import { getE2eDatabaseUrl } from './settings.js'

const install = process.argv[2] === '--install'
if (!install) {
  const pool = await prepareDatabase()
  await pool.end()
}
const args = install ? ['install', 'chromium'] : ['test', ...process.argv.slice(2)]
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: resolve('.playwright-browsers'),
    ...(install ? {} : { E2E_DATABASE_URL: getE2eDatabaseUrl() }),
  },
})
child.on('error', () => { process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
