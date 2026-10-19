import { randomBytes } from 'node:crypto'
import { createApp } from '../server/app.js'
import { prepareDatabase } from './database.js'
import { webOrigin } from './settings.js'

if (process.env.CI && (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  throw new Error('CI requires dedicated test JWT secrets')
}

const pool = await prepareDatabase()
const { app } = createApp({
  accessSecret: process.env.CI
    ? process.env.JWT_ACCESS_SECRET!
    : randomBytes(48).toString('hex'),
  refreshSecret: process.env.CI
    ? process.env.JWT_REFRESH_SECRET!
    : randomBytes(48).toString('hex'),
  origin: webOrigin,
  production: false,
}, pool)
const server = app.listen(3201, '127.0.0.1')
function shutdown(): void {
  server.close(() => { void pool.end().then(() => process.exit(0)) })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
server.on('error', () => { void pool.end().then(() => process.exit(1)) })
