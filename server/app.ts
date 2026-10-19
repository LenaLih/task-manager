import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomUUID, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { z } from 'zod'

export interface Config { database: string; accessSecret: string; refreshSecret: string; origin: string; production: boolean }
interface User { id: string; email: string; password: string }
interface Task { id: string; title: string; completed: number }
const credentials = z.object({ email: z.string().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(10).max(128).refine(v => Buffer.byteLength(v, 'utf8') <= 72) })
const input = z.object({ title: z.string().trim().min(1).max(300), completed: z.boolean().optional() }).strict()
const update = input.partial().refine(v => Object.keys(v).length > 0)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function createApp(config: Config) {
  if (config.accessSecret.length < 32 || config.refreshSecret.length < 32 || config.accessSecret === config.refreshSecret) throw new Error('Set distinct JWT secrets of at least 32 characters')
  const db = new Database(config.database)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(user_id);')
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet(), express.json({ limit: '16kb' }), cookieParser())
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.origin) { res.status(403).json({ message: 'Недопустимый Origin' }); return }
    next()
  })
  const cookie = { httpOnly: true, secure: config.production, sameSite: 'strict' as const, path: '/api/auth' }
  function issue(res: Response, user: Pick<User, 'id' | 'email'>) {
    const refresh = jwt.sign({ sub: user.id, jti: randomUUID(), type: 'refresh' }, config.refreshSecret, { expiresIn: '7d', issuer: 'task-manager', audience: 'refresh' })
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now())
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(refresh), user.id, Date.now() + 7 * 86400000)
    res.cookie('refreshToken', refresh, { ...cookie, maxAge: 7 * 86400000 })
    res.json({ user, accessToken: jwt.sign({ sub: user.id, type: 'access' }, config.accessSecret, { expiresIn: '15m', issuer: 'task-manager', audience: 'access' }) })
  }
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false })
  app.post('/api/auth/register', limiter, async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ message: 'Введите email и пароль: минимум 10 символов, максимум 72 байта UTF-8' }); return }
    const { email, password } = parsed.data
    const encrypted = await bcrypt.hash(password, 12)
    const user = { id: randomUUID(), email }
    try { db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(user.id, email, encrypted) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') { res.status(409).json({ message: 'Email уже зарегистрирован' }); return } throw error }
    res.status(201); issue(res, user)
  })
  app.post('/api/auth/login', limiter, async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ message: 'Некорректные данные' }); return }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.data.email) as User | undefined
    const valid = await bcrypt.compare(parsed.data.password, user?.password ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5vFjBRCx1r7ZbUoLMZNUhsOFEXCjJ9K')
    if (!user || !valid) { res.status(401).json({ message: 'Неверный email или пароль' }); return }
    issue(res, { id: user.id, email: user.email })
  })
  app.post('/api/auth/refresh', (req, res) => {
    const token: unknown = req.cookies.refreshToken
    try {
      if (typeof token !== 'string') throw new Error('Missing token')
      const payload = jwt.verify(token, config.refreshSecret, { algorithms: ['HS256'], issuer: 'task-manager', audience: 'refresh' })
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.type !== 'refresh') throw new Error('Invalid token')
      db.transaction(() => {
        const session = db.prepare('DELETE FROM sessions WHERE hash = ? AND user_id = ? AND expires > ?').run(hash(token), payload.sub, Date.now())
        if (!session.changes) throw new Error('Expired session')
        const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(payload.sub) as Pick<User, 'id' | 'email'> | undefined
        if (!user) throw new Error('Missing user')
        issue(res, user)
      })()
    } catch { res.clearCookie('refreshToken', cookie).status(401).json({ message: 'Сессия завершена' }) }
  })
  app.post('/api/auth/logout', (req, res) => {
    if (typeof req.cookies.refreshToken === 'string') db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash(req.cookies.refreshToken))
    res.clearCookie('refreshToken', cookie).status(204).end()
  })
  app.use('/api/tasks', (req, res, next) => {
    try {
      const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new Error('Missing token')
      const payload = jwt.verify(token, config.accessSecret, { algorithms: ['HS256'], issuer: 'task-manager', audience: 'access' })
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.type !== 'access') throw new Error('Invalid token')
      res.locals.userId = payload.sub; next()
    } catch { res.status(401).json({ message: 'Требуется авторизация' }) }
  })
  const serialize = (task: Task) => ({ ...task, completed: Boolean(task.completed) })
  app.get('/api/tasks', (_req, res) => {
    const tasks = db.prepare('SELECT id, title, completed FROM tasks WHERE user_id = ? ORDER BY rowid').all(res.locals.userId) as Task[]
    res.json(tasks.map(serialize))
  })
  app.get('/api/tasks/:id', (req, res) => {
    const task = db.prepare('SELECT id, title, completed FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, res.locals.userId) as Task | undefined
    if (!task) { res.status(404).json({ message: 'Задача не найдена' }); return }
    res.json(serialize(task))
  })
  app.post('/api/tasks', (req, res) => {
    const parsed = input.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ message: 'Название должно содержать от 1 до 300 символов' }); return }
    const task = { id: randomUUID(), title: parsed.data.title, completed: parsed.data.completed ?? false }
    db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)').run(task.id, res.locals.userId, task.title, Number(task.completed))
    res.status(201).json(task)
  })
  app.patch('/api/tasks/:id', (req, res) => {
    const parsed = update.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ message: 'Некорректная задача' }); return }
    const task = db.prepare('SELECT id, title, completed FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, res.locals.userId) as Task | undefined
    if (!task) { res.status(404).json({ message: 'Задача не найдена' }); return }
    const updated = { id: task.id, title: parsed.data.title ?? task.title, completed: parsed.data.completed ?? Boolean(task.completed) }
    db.prepare('UPDATE tasks SET title = ?, completed = ? WHERE id = ? AND user_id = ?').run(updated.title, Number(updated.completed), task.id, res.locals.userId)
    res.json(updated)
  })
  app.delete('/api/tasks/:id', (req, res) => {
    const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, res.locals.userId)
    if (!result.changes) { res.status(404).json({ message: 'Задача не найдена' }); return }
    res.status(204).end()
  })
  app.use((_req, res) => { res.status(404).json({ message: 'Маршрут не найден' }) })
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof SyntaxError ? 400 : 500
    res.status(status).json({ message: status === 400 ? 'Некорректный JSON' : 'Ошибка сервера' })
  })
  return { app, db }
}
