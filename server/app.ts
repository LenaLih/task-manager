import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { Pool, PoolClient } from 'pg'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { withTransaction } from './db.js'

export interface Config {
  accessSecret: string
  refreshSecret: string
  origin: string
  production: boolean
}
interface User { id: string; email: string; password: string }
interface Task { id: string; title: string; completed: boolean }
type PublicUser = Pick<User, 'id' | 'email'>
const credentials = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
})
const input = z.object({
  title: z.string().trim().min(1).max(300),
  completed: z.boolean().optional(),
}).strict()
const update = input.partial().refine((value) => Object.keys(value).length > 0)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
class InvalidSessionError extends Error {}

export function createApp(config: Config, pool: Pool) {
  if (
    config.accessSecret.length < 32 || config.refreshSecret.length < 32 ||
    config.accessSecret === config.refreshSecret
  ) {
    throw new Error('Set distinct JWT secrets of at least 32 characters')
  }

  const app = express()
  app.disable('x-powered-by')
  app.use(helmet(), express.json({ limit: '16kb' }), cookieParser())
  app.use('/api', (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== config.origin
    ) {
      res.status(403).json({ message: 'Недопустимый Origin' })
      return
    }
    next()
  })

  const cookie = {
    httpOnly: true, secure: config.production,
    sameSite: 'strict' as const, path: '/api/auth',
  }

  // Persist tokens inside the caller's transaction; send nothing before COMMIT.
  async function issue(client: PoolClient, user: PublicUser) {
    const refresh = jwt.sign(
      { sub: user.id, jti: randomUUID(), type: 'refresh' }, config.refreshSecret,
      { expiresIn: '7d', issuer: 'task-manager', audience: 'refresh' },
    )
    const accessToken = jwt.sign(
      { sub: user.id, type: 'access' }, config.accessSecret,
      { expiresIn: '15m', issuer: 'task-manager', audience: 'access' },
    )
    const now = Date.now()
    await client.query('DELETE FROM public.sessions WHERE expires <= $1', [now])
    await client.query(
      'INSERT INTO public.sessions (hash, user_id, expires) VALUES ($1, $2, $3)',
      [hash(refresh), user.id, now + 7 * 86400000],
    )
    return { refresh, accessToken, user }
  }

  function sendSession(res: Response, session: Awaited<ReturnType<typeof issue>>) {
    res.cookie('refreshToken', session.refresh, { ...cookie, maxAge: 7 * 86400000 })
    res.json({ user: session.user, accessToken: session.accessToken })
  }

  const limiter = rateLimit({
    windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false,
  })

  app.post('/api/auth/register', limiter, async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Введите email и пароль: минимум 10 символов, максимум 72 байта UTF-8' })
      return
    }
    const { email, password } = parsed.data
    const encrypted = await bcrypt.hash(password, 12)
    const user = { id: randomUUID(), email }
    try {
      const session = await withTransaction(pool, async (client) => {
        await client.query(
          'INSERT INTO public.users (id, email, password) VALUES ($1, $2, $3)',
          [user.id, email, encrypted],
        )
        return issue(client, user)
      })
      sendSession(res.status(201), session)
    } catch (error) {
      if (
        error instanceof Error && 'code' in error && error.code === '23505' &&
        'constraint' in error && error.constraint === 'users_email_key'
      ) {
        res.status(409).json({ message: 'Email уже зарегистрирован' })
        return
      }
      throw error
    }
  })

  app.post('/api/auth/login', limiter, async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Некорректные данные' })
      return
    }
    const { rows: [user] } = await pool.query<User>(
      'SELECT id, email, password FROM public.users WHERE email = $1',
      [parsed.data.email],
    )
    const valid = await bcrypt.compare(
      parsed.data.password,
      user?.password ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5vFjBRCx1r7ZbUoLMZNUhsOFEXCjJ9K',
    )
    if (!user || !valid) {
      res.status(401).json({ message: 'Неверный email или пароль' })
      return
    }
    const session = await withTransaction(pool, (client) => (
      issue(client, { id: user.id, email: user.email })
    ))
    sendSession(res, session)
  })

  app.post('/api/auth/refresh', async (req, res) => {
    const token: unknown = req.cookies.refreshToken
    let userId: string
    try {
      if (typeof token !== 'string') throw new InvalidSessionError()
      const payload = jwt.verify(token, config.refreshSecret, {
        algorithms: ['HS256'], issuer: 'task-manager', audience: 'refresh',
      })
      if (
        typeof payload === 'string' || typeof payload.sub !== 'string' ||
        payload.type !== 'refresh'
      ) throw new InvalidSessionError()
      userId = payload.sub
    } catch {
      res.clearCookie('refreshToken', cookie).status(401).json({ message: 'Сессия завершена' })
      return
    }

    try {
      const session = await withTransaction(pool, async (client) => {
        const consumed = await client.query(
          `DELETE FROM public.sessions
           WHERE hash = $1 AND user_id = $2 AND expires > $3 RETURNING user_id`,
          [hash(token as string), userId, Date.now()],
        )
        if (!consumed.rowCount) throw new InvalidSessionError()
        const { rows: [user] } = await client.query<PublicUser>(
          'SELECT id, email FROM public.users WHERE id = $1', [userId],
        )
        if (!user) throw new InvalidSessionError()
        return issue(client, user)
      })
      sendSession(res, session)
    } catch (error) {
      if (error instanceof InvalidSessionError) {
        res.clearCookie('refreshToken', cookie).status(401).json({ message: 'Сессия завершена' })
        return
      }
      // Database outages and transaction failures must reach the 500 handler.
      throw error
    }
  })

  app.post('/api/auth/logout', async (req, res) => {
    if (typeof req.cookies.refreshToken === 'string') {
      await pool.query('DELETE FROM public.sessions WHERE hash = $1', [hash(req.cookies.refreshToken)])
    }
    res.clearCookie('refreshToken', cookie).status(204).end()
  })

  app.use('/api/tasks', (req, res, next) => {
    try {
      const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new Error('Missing token')
      const payload = jwt.verify(token, config.accessSecret, {
        algorithms: ['HS256'], issuer: 'task-manager', audience: 'access',
      })
      if (
        typeof payload === 'string' || typeof payload.sub !== 'string' ||
        payload.type !== 'access'
      ) throw new Error('Invalid token')
      res.locals.userId = payload.sub
    } catch {
      res.status(401).json({ message: 'Требуется авторизация' })
      return
    }
    next()
  })

  app.get('/api/tasks', async (_req, res) => {
    const { rows } = await pool.query<Task>(
      'SELECT id, title, completed FROM public.tasks WHERE user_id = $1 ORDER BY position',
      [res.locals.userId],
    )
    res.json(rows)
  })

  app.get('/api/tasks/:id', async (req, res) => {
    const { rows: [task] } = await pool.query<Task>(
      'SELECT id, title, completed FROM public.tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, res.locals.userId],
    )
    if (!task) {
      res.status(404).json({ message: 'Задача не найдена' })
      return
    }
    res.json(task)
  })

  app.post('/api/tasks', async (req, res) => {
    const parsed = input.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Название должно содержать от 1 до 300 символов' })
      return
    }
    const { rows: [task] } = await pool.query<Task>(
      `INSERT INTO public.tasks (id, user_id, title, completed) VALUES ($1, $2, $3, $4)
       RETURNING id, title, completed`,
      [randomUUID(), res.locals.userId, parsed.data.title, parsed.data.completed ?? false],
    )
    res.status(201).json(task)
  })

  app.patch('/api/tasks/:id', async (req, res) => {
    const parsed = update.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Некорректная задача' })
      return
    }
    const { rows: [task] } = await pool.query<Task>(
      `UPDATE public.tasks
       SET title = COALESCE($1::text, title), completed = COALESCE($2::boolean, completed)
       WHERE id = $3 AND user_id = $4 RETURNING id, title, completed`,
      [parsed.data.title ?? null, parsed.data.completed ?? null, req.params.id, res.locals.userId],
    )
    if (!task) {
      res.status(404).json({ message: 'Задача не найдена' })
      return
    }
    res.json(task)
  })

  app.delete('/api/tasks/:id', async (req, res) => {
    const result = await pool.query(
      'DELETE FROM public.tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, res.locals.userId],
    )
    if (!result.rowCount) {
      res.status(404).json({ message: 'Задача не найдена' })
      return
    }
    res.status(204).end()
  })

  app.use((_req, res) => { res.status(404).json({ message: 'Маршрут не найден' }) })
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const malformedJson = error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed'
    res.status(malformedJson ? 400 : 500).json({
      message: malformedJson ? 'Некорректный JSON' : 'Ошибка сервера',
    })
  })
  return { app, db: pool }
}
