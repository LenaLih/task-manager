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
import { addProjectRoutes } from './projects.js'
import { addAnalyticsRoutes } from './analytics.js'
import { addPasswordResetRoutes, emailInput, passwordInput } from './password-reset.js'
import type { SendResetMail } from './password-reset.js'
import { addAccountRoutes } from './account.js'
import { addFinanceRoutes } from './finance.js'
import { addAdminRoutes } from './admin.js'
import { tasksCsv } from './task-export.js'

export interface Config {
  accessSecret: string
  refreshSecret: string
  origin: string
  production: boolean
  sendResetMail?: SendResetMail
}
interface User { id: string; email: string; password: string }
type PublicUser = Pick<User, 'id' | 'email'>
const credentials = z.object({
  email: emailInput,
  password: passwordInput,
})
const taskStatus = z.enum(['backlog', 'todo', 'in-progress', 'done'])
const projectIdInput = z.uuid().nullable()
const taskZone = z.string().max(100).regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/).refine(zone => {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true } catch { return false }
})
const subtask = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(120), completed: z.boolean() }).strict()
const input = z.object({
  title: z.string().trim().min(1).max(300),
  completed: z.boolean().optional(),
  description: z.string().trim().max(3000).optional(),
  status: taskStatus.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  startsOn: z.iso.date().refine((date) => !date.startsWith('0000-')).nullable().optional(),
  dueOn: z.iso.date().refine((date) => !date.startsWith('0000-')).nullable().optional(),
  dueTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  dueZone: taskZone.nullable().optional(),
  reminderMinutes: z.literal([0, 15, 60, 1440]).nullable().optional(),
  projectId: projectIdInput.optional(),
  category: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12)
    .transform(tags => [...new Set(tags.map(tag => tag.toLowerCase()))]).optional(),
  subtasks: z.array(subtask).max(20)
    .refine(items => new Set(items.map(item => item.id)).size === items.length).optional(),
}).strict()
const bulkInput = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(100).transform(ids => [...new Set(ids)]),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('status'), status: taskStatus }).strict(),
    z.object({ type: z.literal('project'), projectId: projectIdInput }).strict(),
    z.object({ type: z.literal('delete') }).strict(),
  ]),
}).strict()
const update = input.partial().refine((value) => Object.keys(value).length > 0)
type TaskInput = z.infer<typeof update>
type TaskRow = {
  id: string
  title: string
  completed: boolean
  description: string
  status: NonNullable<TaskInput['status']>
  priority: NonNullable<TaskInput['priority']>
  startsOn: string | null
  dueOn: string | null
  dueTime: string | null
  dueZone: string | null
  reminderMinutes: NonNullable<TaskInput['reminderMinutes']> | null
  remindAt: number | null
  projectId: string | null
  category: string
  tags: string[]
  subtasks: z.infer<typeof subtask>[]
}
const taskColumns = `id, title, completed, description, status, priority,
  to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(due_on, 'YYYY-MM-DD') AS "dueOn",
  left(due_time::text, 5) AS "dueTime", due_zone AS "dueZone", reminder_minutes AS "reminderMinutes",
  CASE WHEN reminder_minutes = 1440 THEN
    extract(epoch FROM (((due_on - 1) + due_time) AT TIME ZONE due_zone))::float8 * 1000
  ELSE (extract(epoch FROM ((due_on + due_time) AT TIME ZONE due_zone))::float8 - reminder_minutes * 60) * 1000
  END AS "remindAt",
  project_id AS "projectId", category, tags, subtasks`
const consistentCompletion = ({ status, completed }: TaskInput) =>
  status === undefined || completed === undefined || (status === 'done') === completed
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
  // Trust only the immediate local Next.js proxy, never arbitrary forwarded hops.
  app.set('trust proxy', (address: string, hop: number) => (
    hop === 0 && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
  ))
  app.use(helmet())
  app.use('/api/tasks', express.json({ limit: '48kb' }))
  app.use(express.json({ limit: '16kb' }), cookieParser())
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== config.origin
    ) {
      res.status(403).json({ message: 'Недопустимый Origin' })
      return
    }
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  const cookie = {
    httpOnly: true, secure: config.production,
    sameSite: 'strict' as const, path: '/api/auth',
  }

  // Persist tokens inside the caller's transaction; send nothing before COMMIT.
  async function issue(client: PoolClient, user: PublicUser, device: string, id = randomUUID(), createdAt = new Date()) {
    const refresh = jwt.sign(
      { sub: user.id, jti: randomUUID(), type: 'refresh' }, config.refreshSecret,
      { expiresIn: '7d', issuer: 'task-manager', audience: 'refresh' },
    )
    const accessToken = jwt.sign(
      { sub: user.id, jti: randomUUID(), type: 'access', sid: id }, config.accessSecret,
      { expiresIn: '15m', issuer: 'task-manager', audience: 'access' },
    )
    const now = Date.now()
    await client.query('DELETE FROM public.sessions WHERE expires <= $1', [now])
    await client.query(
      'INSERT INTO public.sessions (hash, user_id, expires, id, created_at, device) VALUES ($1, $2, $3, $4, $5, $6)',
      [hash(refresh), user.id, now + 7 * 86400000, id, createdAt, device],
    )
    await client.query(
      `UPDATE public.users SET last_active_at = now() WHERE id = $1
       AND (last_active_at IS NULL OR last_active_at < now() - interval '1 hour')`,
      [user.id],
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

  addPasswordResetRoutes(app, pool, config.origin, config.sendResetMail)

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
        return issue(client, user, req.get('user-agent')?.slice(0, 240) ?? '')
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
    const session = await withTransaction(pool, async (client) => {
      const { rows: [current] } = await client.query<User>(
        'SELECT id, email, password FROM public.users WHERE id = $1 FOR UPDATE', [user.id],
      )
      if (!current || current.password !== user.password || current.email !== user.email) return null
      return issue(client, { id: current.id, email: current.email }, req.get('user-agent')?.slice(0, 240) ?? '')
    })
    if (!session) {
      res.status(401).json({ message: 'Неверный email или пароль' })
      return
    }
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
        const { rows: [user] } = await client.query<PublicUser>(
          'SELECT id, email FROM public.users WHERE id = $1 FOR UPDATE', [userId],
        )
        if (!user) throw new InvalidSessionError()
        const { rows: [consumed] } = await client.query<{ id: ReturnType<typeof randomUUID>; device: string; created_at: Date }>(
          `DELETE FROM public.sessions
           WHERE hash = $1 AND user_id = $2 AND expires > $3 RETURNING id, device, created_at`,
          [hash(token as string), userId, Date.now()],
        )
        if (!consumed) throw new InvalidSessionError()
        return issue(client, user, consumed.device, consumed.id, consumed.created_at)
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

  app.use(['/api/tasks', '/api/projects', '/api/analytics', '/api/account', '/api/finance', '/api/admin'], async (req, res, next) => {
    try {
      const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new Error('Missing token')
      const payload = jwt.verify(token, config.accessSecret, {
        algorithms: ['HS256'], issuer: 'task-manager', audience: 'access',
      })
      if (
        typeof payload === 'string' || typeof payload.sub !== 'string' ||
        payload.type !== 'access' || !z.uuid().safeParse(payload.sid).success
      ) throw new Error('Invalid token')
      res.locals.userId = payload.sub
      res.locals.sessionId = payload.sid
    } catch {
      res.status(401).json({ message: 'Требуется авторизация' })
      return
    }
    const active = await pool.query(
      'SELECT 1 FROM public.sessions WHERE id = $1 AND user_id = $2 AND expires > $3',
      [res.locals.sessionId, res.locals.userId, Date.now()],
    )
    if (!active.rowCount) { res.status(401).json({ message: 'Сессия завершена' }); return }
    next()
  })
  addAccountRoutes(app, pool, res => { res.clearCookie('refreshToken', cookie) }, config.sendResetMail)
  addProjectRoutes(app, pool)
  addFinanceRoutes(app, pool)
  addAnalyticsRoutes(app, pool)
  addAdminRoutes(app, pool)

  app.get('/api/tasks', async (_req, res) => {
    const { rows } = await pool.query<TaskRow>(
      `SELECT ${taskColumns} FROM public.tasks WHERE user_id = $1 ORDER BY position`,
      [res.locals.userId],
    )
    res.json(rows)
  })

  app.get('/api/tasks/export/:format', async (req, res) => {
    const { format } = req.params
    if (format !== 'csv' && format !== 'json') { res.status(404).end(); return }
    const { rows } = await pool.query<TaskRow>(
      `SELECT ${taskColumns} FROM public.tasks WHERE user_id = $1 ORDER BY position`, [res.locals.userId],
    )
    res.attachment(`yasno-tasks.${format}`)
    if (format === 'csv') res.type('text/csv; charset=utf-8').send(tasksCsv(rows))
    else res.json(rows)
  })

  app.get('/api/tasks/:id', async (req, res) => {
    const { rows: [task] } = await pool.query<TaskRow>(
      `SELECT ${taskColumns} FROM public.tasks WHERE id = $1 AND user_id = $2`,
      [req.params.id, res.locals.userId],
    )
    if (!task) {
      res.status(404).json({ message: 'Задача не найдена' })
      return
    }
    res.json(task)
  })

  app.get('/api/tasks/:id/history', async (req, res) => {
    const owner = [res.locals.userId, req.params.id]
    const { rows } = await pool.query(
      `SELECT id::text, action, fields, occurred_at AS "occurredAt" FROM public.task_history
       WHERE user_id = $1 AND task_id = $2 ORDER BY id DESC LIMIT 100`, owner,
    )
    if (!rows.length) {
      const exists = await pool.query('SELECT 1 FROM public.tasks WHERE user_id = $1 AND id = $2', owner)
      if (!exists.rowCount) { res.status(404).json({ message: 'Задача не найдена' }); return }
    }
    res.json(rows)
  })

  app.post('/api/tasks/bulk', async (req, res) => {
    const parsed = bulkInput.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ message: 'Проверьте выбранные задачи и действие' }); return }
    const { ids, action } = parsed.data
    const owner = [res.locals.userId, ids]
    const updated = await withTransaction(pool, async client => {
      const locked = await client.query(
        'SELECT id FROM public.tasks WHERE user_id = $1 AND id = ANY($2::text[]) ORDER BY id FOR UPDATE', owner,
      )
      if (locked.rowCount !== ids.length) return false
      if (action.type === 'delete') {
        await client.query('DELETE FROM public.tasks WHERE user_id = $1 AND id = ANY($2::text[])', owner)
      } else if (action.type === 'status') {
        await client.query(
          "UPDATE public.tasks SET status = $3, completed = ($3 = 'done') WHERE user_id = $1 AND id = ANY($2::text[])",
          [...owner, action.status],
        )
      } else {
        await client.query(
          'UPDATE public.tasks SET project_id = $3 WHERE user_id = $1 AND id = ANY($2::text[])',
          [...owner, action.projectId],
        )
      }
      return true
    })
    if (!updated) { res.status(404).json({ message: 'Одна или несколько задач недоступны' }); return }
    res.status(204).end()
  })

  app.post('/api/tasks', async (req, res) => {
    const parsed = input.safeParse(req.body)
    if (!parsed.success || !consistentCompletion(parsed.data)) {
      res.status(400).json({ message: 'Проверьте название и параметры задачи' })
      return
    }
    const { title, completed, description = '', priority = 'medium', startsOn, dueOn, dueTime, dueZone, reminderMinutes,
      projectId, category = '', tags = [], subtasks = [] } = parsed.data
    if (startsOn && dueOn && startsOn > dueOn) {
      res.status(400).json({ message: 'Срок должен быть не раньше даты начала' })
      return
    }
    const status = parsed.data.status ?? (completed ? 'done' : 'todo')
    const { rows: [task] } = await pool.query<TaskRow>(
      `INSERT INTO public.tasks (id, user_id, title, completed, description, status, priority, starts_on,
         due_on, project_id, category, tags, subtasks, due_time, due_zone, reminder_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING ${taskColumns}`,
      [randomUUID(), res.locals.userId, title, status === 'done', description, status, priority,
        startsOn, dueOn, projectId, category, tags, JSON.stringify(subtasks), dueTime, dueZone, reminderMinutes],
    )
    res.status(201).json(task)
  })

  app.patch('/api/tasks/:id', async (req, res) => {
    const parsed = update.safeParse(req.body)
    if (!parsed.success || !consistentCompletion(parsed.data)) {
      res.status(400).json({ message: 'Некорректная задача' })
      return
    }
    const { title, completed, description, status, priority, startsOn, dueOn, dueTime, dueZone, reminderMinutes,
      projectId, category, tags, subtasks } = parsed.data
    const clearsDate = dueOn === null
    const clearsTime = clearsDate || dueTime === null
    if (clearsTime && (dueTime || dueZone || reminderMinutes != null)) {
      res.status(400).json({ message: 'Укажите дату и время дедлайна для напоминания.' })
      return
    }
    const nextStatus = `COALESCE($4::text, CASE WHEN $3::boolean THEN 'done'
      WHEN $3 = false AND status = 'done' THEN 'todo' ELSE status END)`
    let task: TaskRow | undefined
    try {
      const result = await pool.query<TaskRow>(
        `UPDATE public.tasks SET title = COALESCE($1, title), description = COALESCE($2, description),
         status = ${nextStatus}, completed = (${nextStatus} = 'done'),
         priority = COALESCE($5, priority),
         starts_on = CASE WHEN $6::boolean THEN $7::date ELSE starts_on END,
         due_on = CASE WHEN $8::boolean THEN $9::date ELSE due_on END,
         project_id = CASE WHEN $12::boolean THEN $13::text ELSE project_id END,
         category = COALESCE($14, category), tags = COALESCE($15, tags),
         subtasks = COALESCE($16, subtasks),
         due_time = CASE WHEN $17::boolean THEN $18::time ELSE due_time END,
         due_zone = CASE WHEN $19::boolean THEN $20::text ELSE due_zone END,
         reminder_minutes = CASE WHEN $21::boolean THEN $22::integer ELSE reminder_minutes END
         WHERE id = $10 AND user_id = $11 RETURNING ${taskColumns}`,
        [title, description, completed, status, priority, startsOn !== undefined, startsOn,
          dueOn !== undefined, dueOn, req.params.id, res.locals.userId,
          projectId !== undefined, projectId, category, tags, subtasks && JSON.stringify(subtasks),
          clearsDate || dueTime !== undefined, clearsDate ? null : dueTime,
          clearsTime || dueZone !== undefined, clearsTime ? null : dueZone,
          clearsTime || reminderMinutes !== undefined, clearsTime ? null : reminderMinutes],
      )
      task = result.rows[0]
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'constraint' in error &&
        error.constraint === 'tasks_date_order') {
        res.status(400).json({ message: 'Срок должен быть не раньше даты начала' })
        return
      }
      throw error
    }
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
    if (typeof error === 'object' && error !== null &&
      (('constraint' in error && error.constraint === 'tasks_timed_deadline') ||
        ('code' in error && error.code === '22023'))) {
      res.status(400).json({ message: 'Проверьте дату, время, часовой пояс и напоминание.' })
      return
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ message: 'Запрос слишком большой' })
      return
    }
    if (typeof error === 'object' && error !== null && 'constraint' in error &&
      error.constraint === 'tasks_active_project') {
      res.status(409).json({ message: 'Проект недоступен для назначения' })
      return
    }
    const malformedJson = error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed'
    res.status(malformedJson ? 400 : 500).json({
      message: malformedJson ? 'Некорректный JSON' : 'Ошибка сервера',
    })
  })
  return { app, db: pool }
}
