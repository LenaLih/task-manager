import 'dotenv/config'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createPostgresPool } from './db'
import { runMigrations } from './migrate'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { createApp } from './app'
if (process.env.CI && (
  !process.env.TEST_DATABASE_URL
  || !process.env.JWT_ACCESS_SECRET
  || !process.env.JWT_REFRESH_SECRET
)) {
  throw new Error('CI requires TEST_DATABASE_URL and dedicated test JWT secrets')
}
const config = {
  accessSecret: process.env.CI ? process.env.JWT_ACCESS_SECRET! : 'test-access-secret-'.repeat(3),
  refreshSecret: process.env.CI ? process.env.JWT_REFRESH_SECRET! : 'test-refresh-secret-'.repeat(3),
  origin: 'http://localhost:5173',
  production: false,
}
let instance: ReturnType<typeof createApp>

const password = 'test-password-123'
async function register(email = 'one@example.com') {
  const response = await request(instance.app).post('/api/auth/register').set('Origin', config.origin).send({ email, password }).expect(201)
  return { token: String(response.body.accessToken), cookie: response.headers['set-cookie'] as unknown as string[], id: String(response.body.user.id) }
}
const testUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!testUrl)('auth and task API (dedicated PostgreSQL)', () => {
  let pool: Pool

  beforeAll(async () => {
    const url = new URL(testUrl!)
    const database = decodeURIComponent(url.pathname.slice(1))
    if (!database.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL database name must end with _test')
    }
    if (process.env.DATABASE_URL) {
      const appUrl = new URL(process.env.DATABASE_URL)
      if (decodeURIComponent(appUrl.pathname.slice(1)) === database) {
        throw new Error('Test and application database names must differ')
      }
    }
    pool = createPostgresPool(testUrl)
    const { rows } = await pool.query('SELECT current_database() AS name')
    if (rows[0].name !== database) throw new Error('Unexpected test database')
    await runMigrations(pool)
  })

  beforeEach(async () => {
    vi.restoreAllMocks()
    await pool.query('DROP TRIGGER IF EXISTS reject_session ON public.sessions')
    await pool.query('DROP FUNCTION IF EXISTS public.reject_session()')
    await pool.query('TRUNCATE public.sessions, public.tasks, public.users RESTART IDENTITY')
    instance = createApp(config, pool)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await pool?.end()
  })

  it('requires secure cookies in production and rejects unsafe configuration', async () => {
    expect(() => createApp({ ...config, accessSecret: 'short' }, pool)).toThrow()
    expect(() => createApp({ ...config, refreshSecret: config.accessSecret }, pool)).toThrow()
    instance = createApp({ ...config, production: true }, pool)
    const user = await register()
    expect(user.cookie[0]).toContain('Secure')
  })
  it('hashes passwords, sets protected cookie, logs in and rejects duplicates / wrong password', async () => {
    const user = await register()
    expect(user.cookie[0]).toContain('HttpOnly')
    expect(user.cookie[0]).toContain('SameSite=Strict')
    const { rows: [row] } = await pool.query<{ password: string }>(
      'SELECT password FROM public.users WHERE id = $1', [user.id],
    )
    expect(row.password).not.toBe(password)
    expect(await bcrypt.compare(password, row.password)).toBe(true)
    await request(instance.app).post('/api/auth/login').set('Origin', config.origin).send({ email: 'ONE@example.com', password }).expect(200)
    await request(instance.app).post('/api/auth/login').set('Origin', config.origin).send({ email: 'one@example.com', password: 'wrong-password' }).expect(401)
    await request(instance.app).post('/api/auth/register').set('Origin', config.origin).send({ email: 'one@example.com', password }).expect(409)
  })
  it('implements CRUD and prevents reading, editing or deleting another user task', async () => {
    const one = await register(); const two = await register('two@example.com')
    const created = await request(instance.app).post('/api/tasks').set('Origin', config.origin).auth(one.token, { type: 'bearer' }).send({ title: ' Plan ' }).expect(201)
    const id = String(created.body.id)
    expect(created.body).toMatchObject({ title: 'Plan', completed: false })
    const list = await request(instance.app).get('/api/tasks').auth(two.token, { type: 'bearer' }).expect(200)
    expect(list.body).toEqual([])
    await request(instance.app).get('/api/tasks/' + id).auth(two.token, { type: 'bearer' }).expect(404)
    await request(instance.app).patch('/api/tasks/' + id).set('Origin', config.origin).auth(two.token, { type: 'bearer' }).send({ title: 'Stolen' }).expect(404)
    await request(instance.app).delete('/api/tasks/' + id).set('Origin', config.origin).auth(two.token, { type: 'bearer' }).expect(404)
    const updated = await request(instance.app).patch('/api/tasks/' + id).set('Origin', config.origin).auth(one.token, { type: 'bearer' }).send({ completed: true, title: 'Done' }).expect(200)
    expect(updated.body).toMatchObject({ completed: true, title: 'Done' })
    await request(instance.app).delete('/api/tasks/' + id).set('Origin', config.origin).auth(one.token, { type: 'bearer' }).expect(204)
    await request(instance.app).get('/api/tasks/' + id).auth(one.token, { type: 'bearer' }).expect(404)
  })
  it('rotates refresh tokens and revokes them on logout', async () => {
    const user = await register()
    const refreshed = await request(instance.app).post('/api/auth/refresh').set('Origin', config.origin).set('Cookie', user.cookie).expect(200)
    const newCookie = refreshed.headers['set-cookie'] as unknown as string[]
    expect(newCookie).not.toEqual(user.cookie)
    await request(instance.app).post('/api/auth/refresh').set('Origin', config.origin).set('Cookie', user.cookie).expect(401)
    await request(instance.app).post('/api/auth/logout').set('Origin', config.origin).set('Cookie', newCookie).expect(204)
    await request(instance.app).post('/api/auth/refresh').set('Origin', config.origin).set('Cookie', newCookie).expect(401)
  })
  it('rejects expired access, invalid refresh, missing auth, bad inputs and foreign origins', async () => {
    const user = await register()
    const expired = jwt.sign({ sub: user.id, type: 'access' }, config.accessSecret, { expiresIn: -1, issuer: 'task-manager', audience: 'access' })
    await request(instance.app).get('/api/tasks').auth(expired, { type: 'bearer' }).expect(401)
    await request(instance.app).get('/api/tasks').expect(401)
    await request(instance.app).post('/api/auth/refresh').set('Origin', config.origin).set('Cookie', 'refreshToken=invalid').expect(401)
    await request(instance.app).post('/api/tasks').set('Origin', 'https://foreign.example').auth(user.token, { type: 'bearer' }).send({ title: 'Bad' }).expect(403)
    for (const body of [{ title: ' ' }, { title: 'x', user_id: user.id }, { title: 'x', completed: 'yes' }]) {
      await request(instance.app).post('/api/tasks').set('Origin', config.origin).auth(user.token, { type: 'bearer' }).send(body).expect(400)
    }
    await request(instance.app).post('/api/auth/register').set('Origin', config.origin).send({ email: 'bad', password: 'short' }).expect(400)
    await request(instance.app).post('/api/auth/register').set('Origin', config.origin).send({ email: 'long@example.com', password: 'я'.repeat(40) }).expect(400)
  })

  it('allows exactly one concurrent refresh for the same token', async () => {
    const user = await register()
    const responses = await Promise.all([1, 2].map(() => (
      request(instance.app).post('/api/auth/refresh')
        .set('Origin', config.origin).set('Cookie', user.cookie)
    )))
    expect(responses.map(response => response.status).sort()).toEqual([200, 401])
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM public.sessions')
    expect(rows[0].count).toBe(1)
  })

  it('returns 500 without clearing cookies on a refresh database outage', async () => {
    const user = await register()
    vi.spyOn(pool, 'connect').mockRejectedValueOnce(new Error('Database unavailable'))
    const response = await request(instance.app).post('/api/auth/refresh')
      .set('Origin', config.origin).set('Cookie', user.cookie).expect(500)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.body).toEqual({ message: 'Ошибка сервера' })
    await request(instance.app).post('/api/auth/refresh')
      .set('Origin', config.origin).set('Cookie', user.cookie).expect(200)
  })

  async function rejectSessionInsert() {
    await pool.query(`
      CREATE FUNCTION public.reject_session() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Test session insert failure'; END $$;
      CREATE TRIGGER reject_session BEFORE INSERT ON public.sessions
      FOR EACH ROW EXECUTE FUNCTION public.reject_session();
    `)
  }

  it('rolls back registration if session creation fails', async () => {
    await rejectSessionInsert()
    const response = await request(instance.app).post('/api/auth/register')
      .set('Origin', config.origin).send({ email: 'rollback@example.com', password }).expect(500)
    expect(response.headers['set-cookie']).toBeUndefined()
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM public.users')
    expect(rows[0].count).toBe(0)
  })

  it('rolls back refresh consumption if issuing the replacement fails', async () => {
    const user = await register()
    await rejectSessionInsert()
    const response = await request(instance.app).post('/api/auth/refresh')
      .set('Origin', config.origin).set('Cookie', user.cookie).expect(500)
    expect(response.headers['set-cookie']).toBeUndefined()
    await pool.query('DROP TRIGGER reject_session ON public.sessions')
    await pool.query('DROP FUNCTION public.reject_session()')
    await request(instance.app).post('/api/auth/refresh')
      .set('Origin', config.origin).set('Cookie', user.cookie).expect(200)
  })

  it('preserves both fields during concurrent partial task updates', async () => {
    const user = await register()
    const created = await request(instance.app).post('/api/tasks')
      .set('Origin', config.origin).auth(user.token, { type: 'bearer' })
      .send({ title: 'Original' }).expect(201)
    await Promise.all([{ title: 'Renamed' }, { completed: true }].map(body => (
      request(instance.app).patch('/api/tasks/' + created.body.id)
        .set('Origin', config.origin).auth(user.token, { type: 'bearer' }).send(body).expect(200)
    )))
    const response = await request(instance.app).get('/api/tasks/' + created.body.id)
      .auth(user.token, { type: 'bearer' }).expect(200)
    expect(response.body).toEqual({ id: created.body.id, title: 'Renamed', completed: true })
  })
})
