import { createHash, randomBytes } from 'node:crypto'
import type { Express } from 'express'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import type { Pool } from 'pg'
import { z } from 'zod'
import { withTransaction } from './db.js'

export type SendResetMail = (email: string, content: string, purpose?: 'email-change') => Promise<void>

export const emailInput = z.string().email().max(254).transform((value) => value.toLowerCase())
export const passwordInput = z.string().min(10).max(128)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72)

const forgotInput = z.object({ email: emailInput })
const resetInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: passwordInput,
})
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const windowMs = 15 * 60_000
const tooMany = { message: 'Слишком много попыток. Попробуйте позже.' }

export function addPasswordResetRoutes(
  app: Express, pool: Pool, origin: string, sendMail?: SendResetMail,
) {
  const forgotLimit = rateLimit({ windowMs, limit: 10, legacyHeaders: false, message: tooMany })
  const addressLimit = rateLimit({
    windowMs, limit: 3, legacyHeaders: false, message: tooMany,
    skip: (req) => !forgotInput.safeParse(req.body).success,
    keyGenerator: (req) => digest(forgotInput.parse(req.body).email),
  })
  const resetLimit = rateLimit({ windowMs, limit: 15, legacyHeaders: false, message: tooMany })

  async function deliverReset(email: string, deliver: SendResetMail) {
    const token = randomBytes(32).toString('base64url')
    const stored = await withTransaction(pool, async (client) => {
      // Use the same user-row lock order as reset, login and refresh.
      const { rows: [user] } = await client.query<{ id: string }>(
        'SELECT id FROM public.users WHERE email = $1 FOR UPDATE', [email],
      )
      if (!user) return false
      await client.query(
        `INSERT INTO public.password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, clock_timestamp() + INTERVAL '15 minutes')
         ON CONFLICT (user_id) DO UPDATE
         SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at`,
        [user.id, digest(token)],
      )
      return true
    })
    if (stored) {
      // Fragments stay out of HTTP requests and standard access logs.
      const link = new URL('/reset-password', origin)
      link.hash = new URLSearchParams({ token }).toString()
      await deliver(email, link.href)
    }
  }

  app.post('/api/auth/forgot-password', forgotLimit, addressLimit, (req, res) => {
    const parsed = forgotInput.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Введите корректный email.' })
      return
    }
    if (!sendMail) {
      res.status(503).json({ message: 'Восстановление пароля временно недоступно.' })
      return
    }
    res.status(202).json({ message: 'Если аккаунт существует, мы отправим письмо со ссылкой.' })
    void deliverReset(parsed.data.email, sendMail).catch(() => {
      console.error('Password reset request could not be processed')
    })
  })

  app.post('/api/auth/reset-password', resetLimit, async (req, res) => {
    const parsed = resetInput.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Проверьте ссылку и требования к новому паролю.' })
      return
    }
    const tokenHash = digest(parsed.data.token)
    const candidate = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM public.password_resets WHERE token_hash = $1 AND expires_at > clock_timestamp()',
      [tokenHash],
    )
    const userId = candidate.rows[0]?.user_id
    const completed = userId && await withTransaction(pool, async (client) => {
      await client.query('SELECT id FROM public.users WHERE id = $1 FOR UPDATE', [userId])
      const consumed = await client.query(
        `DELETE FROM public.password_resets
         WHERE user_id = $1 AND token_hash = $2 AND expires_at > clock_timestamp()`,
        [userId, tokenHash],
      )
      if (!consumed.rowCount) return false
      const passwordHash = await bcrypt.hash(parsed.data.password, 12)
      await client.query('UPDATE public.users SET password = $1 WHERE id = $2', [passwordHash, userId])
      await client.query('DELETE FROM public.sessions WHERE user_id = $1', [userId])
      await client.query('DELETE FROM public.email_changes WHERE user_id = $1', [userId])
      return true
    })
    if (!completed) {
      res.status(400).json({ message: 'Ссылка недействительна или срок её действия истёк.' })
      return
    }
    res.status(204).end()
  })
}
