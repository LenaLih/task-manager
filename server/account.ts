import { createHash, randomBytes } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import type { Pool, PoolClient } from 'pg'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { withTransaction } from './db.js'
import { emailInput, passwordInput } from './password-reset.js'
import type { SendResetMail } from './password-reset.js'

const columns = 'name, email, theme, reminder_days AS "reminderDays", role'
const preferences = z.object({
  name: z.string().trim().max(100).optional(),
  theme: z.enum(['light', 'dark']).optional(),
  reminderDays: z.literal([0, 1, 3, 7]).optional(),
}).strict().refine(value => Object.keys(value).length > 0)
const filterName = z.string().trim().min(1).max(60)
const filter = z.object({
  filter: z.enum(['all', 'active', 'completed']),
  status: z.enum(['', 'backlog', 'todo', 'in-progress', 'done']),
  priority: z.enum(['', 'low', 'medium', 'high', 'urgent']),
  tag: z.string().max(32),
  category: z.string().max(60),
  sort: z.enum(['added', 'title', 'deadline']),
  search: z.string().max(300),
}).strict()
const currentPassword = z.string().min(1).max(128).refine(value => Buffer.byteLength(value) <= 72)
const passwordChange = z.object({
  currentPassword, password: passwordInput, confirmation: passwordInput,
}).strict().refine(value => value.password === value.confirmation && value.password !== value.currentPassword)
const emailChange = z.object({ email: emailInput, currentPassword }).strict()
const codeInput = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function addAccountRoutes(app: Express, pool: Pool, clearRefresh: (res: Response) => void, sendMail?: SendResetMail) {
  const root = '/api/account'
  const rateOptions = { windowMs: 15 * 60_000, legacyHeaders: false,
    message: { message: 'Слишком много попыток. Попробуйте позже.' } }
  const ipLimit = rateLimit({ ...rateOptions, limit: 30 })
  const userLimit = rateLimit({ ...rateOptions, limit: 12, keyGenerator: (_req, res) => res.locals.userId })

  function accountMutation<T>(
    operation: (client: PoolClient, req: Request, res: Response) => Promise<T>,
    afterCommit?: (result: T, res: Response) => Promise<void> | void,
  ) {
    return async (req: Request, res: Response) => {
      try {
        const result = await withTransaction(pool, async client => {
          await client.query('SELECT id FROM public.users WHERE id = $1 FOR UPDATE', [res.locals.userId])
          const session = await client.query(
            'SELECT 1 FROM public.sessions WHERE id = $1 AND user_id = $2 AND expires > $3',
            [res.locals.sessionId, res.locals.userId, Date.now()],
          )
          if (!session.rowCount) throw new AccountError(401, 'Сессия завершена.')
          return operation(client, req, res)
        })
        if (afterCommit) await afterCommit(result, res)
        else if (result === undefined) res.status(204).end()
        else res.json(result)
      } catch (error) {
        if (error instanceof AccountError) { res.status(error.status).json({ message: error.message }); return }
        if (error instanceof Error && 'constraint' in error && error.constraint === 'users_email_key') {
          res.status(409).json({ message: 'Этот email уже используется.' })
          return
        }
        throw error
      }
    }
  }

  function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input)
    if (!result.success) throw new AccountError(400, 'Проверьте введённые данные.')
    return result.data
  }

  async function checkPassword(client: PoolClient, owner: string, password: string) {
    const { rows: [user] } = await client.query<{ email: string; password: string }>(
      'SELECT email, password FROM public.users WHERE id = $1', [owner],
    )
    if (!user || !await bcrypt.compare(password, user.password)) throw new AccountError(403, 'Неверный текущий пароль.')
    return user
  }

  app.get(root, async (_req, res) => {
    const { rows: [profile] } = await pool.query(`SELECT ${columns} FROM public.users WHERE id = $1`, [res.locals.userId])
    res.json(profile)
  })

  app.patch(root, accountMutation(async (client, req, res) => {
    const { name, theme, reminderDays } = parse(preferences, req.body)
    const { rows: [profile] } = await client.query(
      `UPDATE public.users SET name = COALESCE($2, name), theme = COALESCE($3, theme),
       reminder_days = COALESCE($4, reminder_days) WHERE id = $1 RETURNING ${columns}`,
      [res.locals.userId, name, theme, reminderDays],
    )
    return profile
  }))

  app.get(root + '/sessions', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, device, created_at AS "createdAt", expires::float8 AS expires, id = $3 AS current
       FROM public.sessions WHERE user_id = $1 AND expires > $2 ORDER BY current DESC, created_at DESC`,
      [res.locals.userId, Date.now(), res.locals.sessionId],
    )
    res.json(rows)
  })

  app.delete(root + '/sessions', ipLimit, userLimit, accountMutation(async (client, _req, res) => {
    await client.query('DELETE FROM public.sessions WHERE user_id = $1 AND id <> $2', [res.locals.userId, res.locals.sessionId])
  }))

  app.delete(root + '/sessions/:id', ipLimit, userLimit, accountMutation(async (client, req, res) => {
    const id = parse(z.uuid(), req.params.id)
    const deleted = await client.query(
      'DELETE FROM public.sessions WHERE user_id = $1 AND id = $2 AND id <> $3',
      [res.locals.userId, id, res.locals.sessionId],
    )
    if (!deleted.rowCount) throw new AccountError(404, 'Сессия недоступна.')
  }))

  app.post(root + '/password', ipLimit, userLimit, accountMutation(async (client, req, res) => {
    const owner = res.locals.userId
    const input = parse(passwordChange, req.body)
    await checkPassword(client, owner, input.currentPassword)
    await client.query('UPDATE public.users SET password = $2 WHERE id = $1', [owner, await bcrypt.hash(input.password, 12)])
    await client.query('DELETE FROM public.password_resets WHERE user_id = $1', [owner])
    await client.query('DELETE FROM public.email_changes WHERE user_id = $1', [owner])
    await client.query('DELETE FROM public.sessions WHERE user_id = $1', [owner])
  }, (_result, res) => { clearRefresh(res); res.status(204).end() }))

  app.post(root + '/email', ipLimit, userLimit, accountMutation(async (client, req, res) => {
    if (!sendMail) throw new AccountError(503, 'Отправка писем временно недоступна.')
    const code = randomBytes(32).toString('base64url')
    const owner = res.locals.userId
    const { email, currentPassword } = parse(emailChange, req.body)
    const user = await checkPassword(client, owner, currentPassword)
    if (email === user.email) throw new AccountError(400, 'Введите новый email.')
    const existing = await client.query('SELECT 1 FROM public.users WHERE email = $1', [email])
    if (existing.rowCount) throw new AccountError(409, 'Этот email уже используется.')
    await client.query(
      `INSERT INTO public.email_changes (user_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, clock_timestamp() + INTERVAL '15 minutes')
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, token_hash = EXCLUDED.token_hash,
       expires_at = EXCLUDED.expires_at`, [owner, email, digest(code)],
    )
    return { email, code, deliver: sendMail }
  }, async ({ email, code, deliver }, res) => {
    try {
      await deliver(email, code, 'email-change')
    } catch {
      console.error('Email confirmation delivery failed')
      await pool.query('DELETE FROM public.email_changes WHERE user_id = $1 AND token_hash = $2',
        [res.locals.userId, digest(code)])
      throw new AccountError(503, 'Не удалось отправить письмо. Повторите попытку.')
    }
    res.status(204).end()
  }))

  app.post(root + '/email/confirm', ipLimit, userLimit, accountMutation(async (client, req, res) => {
    const { code } = parse(codeInput, req.body)
    const owner = res.locals.userId
    const { rows: [pending] } = await client.query<{ email: string }>(
      `DELETE FROM public.email_changes WHERE user_id = $1 AND token_hash = $2
       AND expires_at > clock_timestamp() RETURNING email`, [owner, digest(code)],
    )
    if (!pending) throw new AccountError(400, 'Код недействителен или срок его действия истёк.')
    await client.query('DELETE FROM public.password_resets WHERE user_id = $1', [owner])
    const { rows: [profile] } = await client.query(
      `UPDATE public.users SET email = $2 WHERE id = $1 RETURNING ${columns}`, [owner, pending.email],
    )
    return profile
  }))

  app.get(root + '/filters', async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT name, filters FROM public.saved_filters WHERE user_id = $1 ORDER BY name', [res.locals.userId],
    )
    res.json(rows)
  })
  app.put(root + '/filters', accountMutation(async (client, req, res) => {
    const { name, filters } = parse(z.object({ name: filterName, filters: filter }).strict(), req.body)
    const owner = res.locals.userId
    const saved = await client.query(
      `INSERT INTO public.saved_filters (user_id, name, filters)
       SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM public.saved_filters WHERE user_id = $1 AND name = $2)
         OR (SELECT count(*) FROM public.saved_filters WHERE user_id = $1) < 30
       ON CONFLICT (user_id, name) DO UPDATE SET filters = EXCLUDED.filters`, [owner, name, JSON.stringify(filters)],
    )
    if (!saved.rowCount) throw new AccountError(409, 'Можно сохранить до 30 фильтров.')
  }))
  app.delete(root + '/filters', accountMutation(async (client, req, res) => {
    const { name } = parse(z.object({ name: filterName }).strict(), req.body)
    await client.query('DELETE FROM public.saved_filters WHERE user_id = $1 AND name = $2', [res.locals.userId, name])
  }))
}
