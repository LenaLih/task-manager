import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './sqlite-app.js'
const database = process.env.DATABASE_PATH ?? './data/tasks.sqlite'
mkdirSync(dirname(database), { recursive: true })
const { app, db } = createApp({ database, accessSecret: process.env.JWT_ACCESS_SECRET ?? '', refreshSecret: process.env.JWT_REFRESH_SECRET ?? '', origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', production: process.env.NODE_ENV === 'production' })
const server = app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1', () => console.log('API: http://localhost:3001'))
function shutdown() { server.close(() => { db.close(); process.exit(0) }) }
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
