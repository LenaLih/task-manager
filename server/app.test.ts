import 'dotenv/config'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createPostgresPool } from './db'
import { runMigrations } from './migrate'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
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

describe.skipIf(!testUrl)('auth and task API (dedicated PostgreSQL)', { timeout: 20_000 }, () => {
  let pool: Pool
  const sendResetMail = vi.fn(async (_email: string, _content: string, _purpose?: 'email-change') => {})

  function forgot(email: string) {
    return request(instance.app).post('/api/auth/forgot-password')
      .set('Origin', config.origin).send({ email })
  }

  function reset(token: string, nextPassword = 'new-test-password') {
    return request(instance.app).post('/api/auth/reset-password')
      .set('Origin', config.origin).send({ token, password: nextPassword })
  }

  async function mailedToken(mailNumber = 1) {
    await vi.waitFor(() => expect(sendResetMail).toHaveBeenCalledTimes(mailNumber))
    const link = new URL(sendResetMail.mock.calls[mailNumber - 1][1])
    expect(link.origin).toBe(config.origin)
    expect(link.pathname).toBe('/reset-password')
    expect(link.search).toBe('')
    return new URLSearchParams(link.hash.slice(1)).get('token')!
  }

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
    sendResetMail.mockClear()
    await pool.query('DROP TRIGGER IF EXISTS reject_session ON public.sessions')
    await pool.query('DROP FUNCTION IF EXISTS public.reject_session()')
    await pool.query(`TRUNCATE public.finance_entries, public.finance_goals, public.finance_budgets, public.finance_accounts,
      public.saved_filters, public.email_changes, public.task_history, public.password_resets,
      public.sessions, public.tasks, public.projects, public.users RESTART IDENTITY`)
    instance = createApp({ ...config, sendResetMail }, pool)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await pool?.end()
  })

  it('protects admin statistics and returns only aggregate and directory fields', async () => {
    const admin = await register('admin@example.test')
    const user = await register('user@example.test')
    const api = request(instance.app)
    const auth = { type: 'bearer' } as const
    for (const path of ['/api/admin/overview', '/api/admin/users']) {
      await api.get(path).expect('Cache-Control', 'no-store').expect(401)
      await api.get(path).auth(admin.token, auth).expect(403)
    }
    await api.patch('/api/account').auth(user.token, auth).set('Origin', config.origin)
      .send({ name: 'Анна', role: 'admin' }).expect(400)
    await api.patch('/api/account').auth(user.token, auth).set('Origin', config.origin)
      .send({ name: 'Анна' }).expect(200)
    await pool.query("UPDATE public.users SET role = 'admin' WHERE id = $1", [admin.id])
    await pool.query(`INSERT INTO public.users (id, email, password, registered_at)
      VALUES ($1, 'legacy@example.test', 'unused', NULL)`, [randomUUID()])
    await pool.query(`INSERT INTO public.tasks (id, user_id, title, completed, status)
      VALUES ($1, $2, 'Private task', true, 'done')`, [randomUUID(), user.id])
    await pool.query(`INSERT INTO public.projects (id, user_id, name)
      VALUES ($1, $2, 'Private project')`, [randomUUID(), user.id])
    const overview = await api.get('/api/admin/overview?days=90').auth(admin.token, auth).expect(200)
    expect(overview.body).toMatchObject({
      users: 3, registeredToday: 2, registered7: 2, registered30: 2, active7: 2, active30: 2,
      tasks: 1, completed: 1, projects: 1,
    })
    expect(overview.body.registrations).toHaveLength(90)
    expect(overview.body.registrations.at(-1).count).toBe(2)
    const first = await api.get('/api/admin/users?sort=tasks&direction=desc&size=1').auth(admin.token, auth).expect(200)
    expect(first.body).toEqual({ total: 3, users: [{
      name: 'Анна', email: 'user@example.test', role: 'user', tasks: 1, completed: 1, projects: 1,
      registeredAt: expect.any(String), registrationKnownBy: null, lastActiveAt: expect.any(String),
    }] })
    const second = await api.get('/api/admin/users?sort=email&direction=asc&size=1&page=2').auth(admin.token, auth).expect(200)
    expect(second.body.users[0]).toMatchObject({ email: 'legacy@example.test', registeredAt: null, lastActiveAt: null })
    for (const search of ['АННА', 'USER@']) {
      const matching = await api.get('/api/admin/users').query({ search }).auth(admin.token, auth).expect(200)
      expect(matching.body).toEqual({ total: 1, users: first.body.users })
    }
    await api.get('/api/admin/users?sort=unknown').auth(admin.token, auth).expect(400)
    await pool.query("UPDATE public.users SET role = 'user' WHERE id = $1", [admin.id])
    await api.get('/api/admin/overview').auth(admin.token, auth).expect(403)
  })

  it('isolates finance and saves transfers and goal contributions once under concurrent retries', async () => {
    const one = await register()
    const other = await register('finance-other@example.test')
    const api = request(instance.app)
    const auth = { type: 'bearer' } as const
    const put = (path: string, body: object, token = one.token) =>
      api.put('/api/finance/' + path).set('Origin', config.origin).auth(token, auth).send(body)
    const account = { name: 'Sample wallet', kind: 'cash', currency: 'KGS', opening: '10001' }
    const source = randomUUID(), destination = randomUUID(), usd = randomUUID(), foreign = randomUUID()
    const goal = randomUUID(), transfer = randomUUID(), expense = randomUUID(), budget = randomUUID()
    await api.get('/api/finance').expect(401)
    await put('accounts/' + source, { ...account, opening: 0.1 }).expect(400)
    await put('accounts/' + source, account).expect(204)
    await put('accounts/' + destination, { ...account, name: 'Sample savings', kind: 'savings', opening: '0' }).expect(204)
    await put('accounts/' + usd, { ...account, currency: 'USD' }).expect(204)
    await put('accounts/' + foreign, account, other.token).expect(204)
    await put('goals/' + goal, { name: 'Sample goal', accountId: destination, target: '10050', deadline: null }).expect(204)
    const date = { day: '2026-11-05', note: '' }
    const contribution = { ...date, accountId: source, destinationId: destination, amount: '1001', goalId: goal, kind: 'transfer' }
    await put('entries/' + transfer, { ...contribution, destinationId: foreign }).expect(404)
    await put('entries/' + transfer, { ...contribution, destinationId: usd }).expect(400)
    await put('entries/' + transfer, { ...contribution, destinationId: source }).expect(400)
    await put('entries/' + transfer, contribution, other.token).expect(404)
    await Promise.all([put('entries/' + transfer, contribution).expect(204), put('entries/' + transfer, contribution).expect(204)])
    const payment = { ...date, accountId: source, kind: 'expense', category: 'Sample', amount: '125' }
    await put('entries/' + expense, payment).expect(204)
    await put('entries/' + expense, { ...payment, amount: '130' }).expect(204)
    const limit = { category: ' SAMPLE ', currency: 'KGS', amount: '150', month: '2026-11-01' }
    await put('budgets/' + budget, limit).expect(204)
    await put('budgets/' + randomUUID(), { ...limit, category: 'sample' }).expect(409)
    const archive = (token: string) => api.patch('/api/finance/accounts/' + source).set('Origin', config.origin)
      .auth(token, auth).send({ archived: true })
    await archive(other.token).expect(404)
    await archive(one.token).expect(204)
    await put('accounts/' + source, { ...account, name: 'Sample wallet edited' }).expect(204)
    await put('entries/' + randomUUID(), payment).expect(409)
    const { body } = await api.get('/api/finance').auth(one.token, auth).expect(200)
    expect(body.accounts).toHaveLength(3)
    expect(body.accounts.find((row: { id: string }) => row.id === source)).toMatchObject({ archived: true, opening: '10001' })
    expect(body.entries).toHaveLength(2)
    expect(body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: transfer, goalId: goal, amount: '1001', destinationId: destination }),
      expect.objectContaining({ id: expense, amount: '130' }),
    ]))
    expect(body.budgets).toEqual([expect.objectContaining({ category: 'sample', amount: '150' })])
    expect(body.goals).toEqual([expect.objectContaining({ id: goal, target: '10050' })])
    const isolated = await api.get('/api/finance').auth(other.token, auth).expect(200)
    expect(isolated.body).toMatchObject({ accounts: [expect.objectContaining({ id: foreign })], entries: [], budgets: [], goals: [] })
    const remove = (token: string) => api.delete('/api/finance/entries/' + expense).set('Origin', config.origin).auth(token, auth)
    await remove(other.token).expect(404)
    await remove(one.token).expect(204)
    const after = await api.get('/api/finance').auth(one.token, auth).expect(200)
    expect(after.body.entries).toEqual([expect.objectContaining({ id: transfer })])
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

  it('resets the password once, revokes refresh and keeps the account and its tasks', async () => {
    const user = await register()
    const task = await request(instance.app).post('/api/tasks').set('Origin', config.origin)
      .auth(user.token, { type: 'bearer' }).send({ title: 'Keep me' }).expect(201)
    await forgot('ONE@example.com').expect(202)
    const token = await mailedToken()
    expect(sendResetMail.mock.calls[0][0]).toBe('one@example.com')
    const { rows } = await pool.query(
      `SELECT user_id, token_hash,
        EXTRACT(EPOCH FROM expires_at - clock_timestamp())::int AS seconds
       FROM public.password_resets`,
    )
    expect(rows[0]).toMatchObject({
      user_id: user.id,
      token_hash: createHash('sha256').update(token).digest('hex'),
    })
    expect(rows[0].seconds).toBeGreaterThan(890)
    expect(rows[0].seconds).toBeLessThanOrEqual(900)
    await reset(token, 'я'.repeat(40)).expect(400)
    const results = await Promise.all([reset(token), reset(token)])
    expect(results.map(result => result.status).sort()).toEqual([204, 400])
    await reset(token).expect(400)
    await request(instance.app).post('/api/auth/refresh').set('Origin', config.origin)
      .set('Cookie', user.cookie).expect(401)
    await request(instance.app).get('/api/tasks').auth(user.token, { type: 'bearer' }).expect(401)
    const login = (secret: string) => request(instance.app).post('/api/auth/login')
      .set('Origin', config.origin).send({ email: 'one@example.com', password: secret })
    await login(password).expect(401)
    const loggedIn = await login('new-test-password').expect(200)
    expect(loggedIn.body.user.id).toBe(user.id)
    const tasks = await request(instance.app).get('/api/tasks')
      .auth(loggedIn.body.accessToken, { type: 'bearer' }).expect(200)
    expect(tasks.body).toEqual([task.body])
  })

  it('returns the same response for unknown addresses and sends mail only for existing accounts', async () => {
    await register()
    const unknown = await forgot('unknown@example.com').expect(202)
    const known = await forgot('one@example.com').expect(202)
    expect(unknown.body).toEqual(known.body)
    await mailedToken()
    expect(sendResetMail.mock.calls.map(([email]) => email)).toEqual(['one@example.com'])
  })

  it('verifies a new email against the original account, once, using a hashed expiring code', async () => {
    const one = await register()
    const other = await register('taken@example.com')
    const sendCode = (email: string, currentPassword = password) => request(instance.app)
      .post('/api/account/email').set('Origin', config.origin).auth(one.token, { type: 'bearer' })
      .send({ email, currentPassword })
    const confirm = (code: string, token = one.token) => request(instance.app)
      .post('/api/account/email/confirm').set('Origin', config.origin).auth(token, { type: 'bearer' }).send({ code })

    await sendCode('TAKEN@example.com').expect(409)
    await sendCode('new@example.com', 'wrong-password').expect(403)
    await sendCode('NEW@example.com').expect(204)
    const [email, code, purpose] = sendResetMail.mock.calls[0]
    expect([email, purpose]).toEqual(['new@example.com', 'email-change'])
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const { rows } = await pool.query('SELECT token_hash FROM public.email_changes WHERE user_id = $1', [one.id])
    expect(rows[0].token_hash).toBe(createHash('sha256').update(code).digest('hex'))
    await confirm(code, other.token).expect(400)
    await pool.query("UPDATE public.email_changes SET expires_at = now() - interval '1 second' WHERE user_id = $1", [one.id])
    await confirm(code).expect(400)

    await sendCode('new@example.com').expect(204)
    const [, next] = sendResetMail.mock.calls[1]
    const confirmations = await Promise.all([confirm(next), confirm(next)])
    expect(confirmations.map(response => response.status).sort()).toEqual([200, 400])
    const confirmed = confirmations.find(response => response.status === 200)!
    expect(confirmed.body).toEqual({ name: '', email: 'new@example.com', theme: null, reminderDays: 0, role: 'user' })
    await request(instance.app).post('/api/auth/login').set('Origin', config.origin)
      .send({ email: 'new@example.com', password }).expect(200)
  })

  it('enforces unique email at confirmation when two accounts request the same address', async () => {
    const accounts = [await register(), await register('two@example.com')]
    for (const account of accounts) {
      await request(instance.app).post('/api/account/email').set('Origin', config.origin)
        .auth(account.token, { type: 'bearer' }).send({ email: 'shared@example.com', currentPassword: password }).expect(204)
    }
    const responses = await Promise.all(accounts.map(({ token }, index) => request(instance.app)
      .post('/api/account/email/confirm').set('Origin', config.origin).auth(token, { type: 'bearer' })
      .send({ code: sendResetMail.mock.calls[index][1] })))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
  })

  it('lists and revokes only owned sessions, including access tokens after password change', async () => {
    const owner = await register()
    const other = await register('outside@example.com')
    const login = () => request(instance.app).post('/api/auth/login').set('Origin', config.origin)
      .send({ email: 'one@example.com', password }).expect(200)
    const parallel = await login()
    const getSessions = (token: string) => request(instance.app).get('/api/account/sessions').auth(token, { type: 'bearer' }).expect(200)
    const list = await getSessions(owner.token)
    expect(list.body.map((session: { current: boolean }) => session.current)).toEqual([true, false])
    const outsideId = (await getSessions(other.token)).body[0].id
    const revoke = (id = '') => request(instance.app).delete('/api/account/sessions' + id)
      .set('Origin', config.origin).auth(owner.token, { type: 'bearer' })
    await revoke('/' + outsideId).expect(404)
    await revoke('/' + list.body[1].id).expect(204)
    await request(instance.app).get('/api/tasks').auth(parallel.body.accessToken, { type: 'bearer' }).expect(401)
    const sibling = await login()
    await revoke().expect(204)
    await request(instance.app).get('/api/tasks').auth(sibling.body.accessToken, { type: 'bearer' }).expect(401)
    expect((await getSessions(owner.token)).body[0].id).toBe(list.body[0].id)

    const change = (currentPassword: string, confirmation: string) => request(instance.app)
      .post('/api/account/password').set('Origin', config.origin).auth(owner.token, { type: 'bearer' })
      .send({ currentPassword, password: 'replacement-password', confirmation })
    await change(password, 'mismatch-password').expect(400)
    await change('incorrect-password', 'replacement-password').expect(403)
    await change(password, 'replacement-password').expect(204)
    await request(instance.app).get('/api/tasks').auth(owner.token, { type: 'bearer' }).expect(401)
    await request(instance.app).post('/api/auth/refresh').set('Origin', config.origin).set('Cookie', owner.cookie).expect(401)
    await getSessions(other.token)
  })

  it('isolates preferences, saved filters and task exports by owner', async () => {
    const one = await register()
    const two = await register('two@example.com')
    await request(instance.app).patch('/api/account').set('Origin', config.origin).auth(one.token, { type: 'bearer' })
      .send({ name: '  Анна ', theme: 'dark', reminderDays: 3 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ name: 'Анна', theme: 'dark', reminderDays: 3 }))
    await request(instance.app).patch('/api/account').set('Origin', config.origin).auth(one.token, { type: 'bearer' })
      .send({ userId: two.id, name: 'Other' }).expect(400)

    const preset = { name: 'Срочные', filters: { filter: 'active', status: '', priority: 'urgent', tag: '', category: '', sort: 'deadline', search: '' } }
    await request(instance.app).put('/api/account/filters').set('Origin', config.origin).auth(one.token, { type: 'bearer' })
      .send(preset).expect(204)
    await request(instance.app).get('/api/account/filters').auth(one.token, { type: 'bearer' }).expect(200).expect([preset])
    await request(instance.app).get('/api/account/filters').auth(two.token, { type: 'bearer' }).expect(200).expect([])
    const create = (token: string, title: string) => request(instance.app).post('/api/tasks')
      .set('Origin', config.origin).auth(token, { type: 'bearer' }).send({ title }).expect(201)
    const own = await create(one.token, 'Моя, "задача"')
    await create(two.token, 'Private')
    await request(instance.app).get('/api/tasks/export/json').expect(401)
    await request(instance.app).get('/api/tasks/export/json').auth(one.token, { type: 'bearer' }).expect(200).expect([own.body])
    const csv = await request(instance.app).get('/api/tasks/export/csv').auth(one.token, { type: 'bearer' }).expect(200)
      .expect('Content-Type', /text\/csv; charset=utf-8/)
    expect(csv.text).toContain('"Моя, ""задача"""')
    expect(csv.text).not.toContain('Private')
  })

  it('limits account security operations per authenticated owner', async () => {
    const one = await register()
    const two = await register('two@example.com')
    const submit = (token: string) => request(instance.app).post('/api/account/email/confirm')
      .set('Origin', config.origin).auth(token, { type: 'bearer' }).send({ code: 'invalid' })
    for (let attempt = 0; attempt < 12; attempt += 1) await submit(one.token).expect(400)
    await submit(one.token).expect(429)
    await submit(two.token).expect(400)
  })

  it('leaves no refresh session after a concurrent reset and refresh', async () => {
    const user = await register()
    await forgot('one@example.com').expect(202)
    const token = await mailedToken()
    const [changed, refreshed] = await Promise.all([
      reset(token),
      request(instance.app).post('/api/auth/refresh')
        .set('Origin', config.origin).set('Cookie', user.cookie),
    ])
    expect(changed.status).toBe(204)
    expect([200, 401]).toContain(refreshed.status)
    const { rows } = await pool.query('SELECT hash FROM public.sessions WHERE user_id = $1', [user.id])
    expect(rows).toEqual([])
  })

  it('replaces previous links and rejects expired links', async () => {
    await register()
    await forgot('one@example.com').expect(202)
    const first = await mailedToken()
    await forgot('one@example.com').expect(202)
    const second = await mailedToken(2)
    expect(first).not.toBe(second)
    await reset(first).expect(400)
    await pool.query("UPDATE public.password_resets SET expires_at = clock_timestamp() - INTERVAL '1 second'")
    await reset(second).expect(400)
  })

  it('limits forgot attempts by normalized email and IP and limits reset attempts by IP', async () => {
    for (let i = 0; i < 3; i++) await forgot('unknown@example.com').expect(202)
    await forgot('UNKNOWN@example.com').expect(429)
    for (let i = 0; i < 6; i++) await forgot(`unknown-${i}@example.com`).expect(202)
    await forgot('another@example.com').expect(429)
    for (let i = 0; i < 15; i++) await reset('invalid').expect(400)
    await reset('invalid').expect(429)
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
    expect(response.body).toMatchObject({ id: created.body.id, title: 'Renamed', completed: true, status: 'done' })
  })

  it('persists planning fields, rejects invalid date changes and limits edits to the owner', async () => {
    const owner = await register()
    const other = await register('other@example.com')
    const details = {
      title: 'Launch', description: 'Publish the release', status: 'backlog', priority: 'urgent',
      startsOn: '2030-05-10', dueOn: '2030-05-15',
    }
    const created = await request(instance.app).post('/api/tasks')
      .set('Origin', config.origin).auth(owner.token, { type: 'bearer' }).send(details).expect(201)
    expect(created.body).toMatchObject({ ...details, completed: false })
    const path = '/api/tasks/' + created.body.id
    const patch = (body: object, token = owner.token) => request(instance.app).patch(path)
      .set('Origin', config.origin).auth(token, { type: 'bearer' }).send(body)
    await patch({ status: 'done' }, other.token).expect(404)
    await patch({ dueOn: '2030-05-01' }).expect(400)
    await patch({ dueOn: '2030-02-30' }).expect(400)
    await patch({ status: 'done', completed: false }).expect(400)
    const updated = await patch({ dueOn: null, status: 'done' }).expect(200)
    expect(updated.body).toMatchObject({ ...details, dueOn: null, status: 'done', completed: true })
    const fetched = await request(instance.app).get(path).auth(owner.token, { type: 'bearer' }).expect(200)
    expect(fetched.body).toEqual(updated.body)
  })

  it('persists timed deadlines, computes reminders in the saved zone and clears dependent fields', async () => {
    const { token } = await register()
    const auth = (req: ReturnType<ReturnType<typeof request>['post']>) =>
      req.set('Origin', config.origin).auth(token, { type: 'bearer' })
    const post = (body: object) => auth(request(instance.app).post('/api/tasks')).send(body)
    const { body: legacy } = await post({ title: 'Date only', dueOn: '2026-12-30' }).expect(201)
    expect(legacy).toMatchObject({ dueTime: null, dueZone: null, reminderMinutes: null, remindAt: null })
    const fields = { dueOn: '2026-12-30', dueTime: '19:00', dueZone: 'Asia/Almaty', reminderMinutes: 15 }
    const { body: task } = await post({ title: 'Cake', ...fields }).expect(201)
    expect(task).toMatchObject({ ...fields, startsOn: null, remindAt: Date.parse('2026-12-30T13:45:00Z') })
    const path = '/api/tasks/' + task.id
    const patch = (body: object) => auth(request(instance.app).patch(path)).send(body)
    await auth(request(instance.app).get(path)).expect(200).expect(task)
    expect((await patch({ reminderMinutes: 60 }).expect(200)).body.remindAt).toBe(Date.parse('2026-12-30T13:00:00Z'))
    expect((await patch({ reminderMinutes: 0 }).expect(200)).body.remindAt).toBe(Date.parse('2026-12-30T14:00:00Z'))
    const day = await patch({ dueOn: '2026-03-29', dueTime: '19:00', dueZone: 'Europe/Berlin', reminderMinutes: 1440 }).expect(200)
    expect(day.body.remindAt).toBe(Date.parse('2026-03-28T18:00:00Z'))
    await patch({ dueTime: '02:30' }).expect(400)
    await patch({ reminderMinutes: 30 }).expect(400)
    expect((await patch({ reminderMinutes: null }).expect(200)).body).toMatchObject({ dueTime: '19:00', remindAt: null })
    expect((await patch({ dueOn: null }).expect(200)).body).toMatchObject({
      dueOn: null, dueTime: null, dueZone: null, reminderMinutes: null, remindAt: null,
    })
    await post({ title: 'No time', dueOn: '2026-12-30', reminderMinutes: 0 }).expect(400)
    await post({ title: 'Bad zone', ...fields, dueZone: 'Unknown/Zone' }).expect(400)
    await post({ title: 'Bad time', ...fields, dueTime: '24:00' }).expect(400)
  })

  it('isolates projects, archives without losing tasks, and updates project totals', async () => {
    const owner = await register()
    const other = await register('other@example.com')
    const post = (url: string, body: object, token = owner.token) => request(instance.app).post(url)
      .set('Origin', config.origin).auth(token, { type: 'bearer' }).send(body)
    const project = await post('/api/projects', { name: 'Planning', color: 'blue', icon: 'flag' }).expect(201)
    const projectId = String(project.body.id)
    const path = '/api/projects/' + projectId
    const patch = (body: object, token = owner.token) => request(instance.app).patch(path)
      .set('Origin', config.origin).auth(token, { type: 'bearer' }).send(body)
    await request(instance.app).get(path).auth(other.token, { type: 'bearer' }).expect(404)
    await patch({ archived: true }, other.token).expect(404)
    await post('/api/tasks', { title: 'Foreign task', projectId }, other.token).expect(409)
    const task = await post('/api/tasks', { title: 'Linked task', projectId, status: 'done' }).expect(201)
    await patch({ name: 'Edited project', archived: true }).expect(204)
    await post('/api/tasks', { title: 'Blocked task', projectId }).expect(409)
    const summary = await request(instance.app).get(path).auth(owner.token, { type: 'bearer' }).expect(200)
    expect(summary.body).toMatchObject({ name: 'Edited project', archived: true, total: 1, done: 1 })
    const linked = await request(instance.app).get('/api/tasks/' + task.body.id)
      .auth(owner.token, { type: 'bearer' }).expect(200)
    expect(linked.body.projectId).toBe(projectId)
  })

  it('persists task metadata and history and rejects mixed-owner bulk actions atomically', async () => {
    const owner = await register()
    const other = await register('other@example.com')
    const post = (url: string, body: object, token = owner.token) => request(instance.app).post(url)
      .set('Origin', config.origin).auth(token, { type: 'bearer' }).send(body)
    const subtasks = [{ id: '88c1095d-81d3-4a00-8888-818fc359651f', title: 'One step', completed: true }]
    const first = await post('/api/tasks', { title: 'One', tags: ['QA', 'qa'], category: 'Release', subtasks }).expect(201)
    expect(first.body).toMatchObject({ subtasks, tags: ['qa'], category: 'Release' })
    const second = await post('/api/tasks', { title: 'Two' }).expect(201)
    const foreign = await post('/api/tasks', { title: 'Foreign' }, other.token).expect(201)
    const bulk = (ids: string[]) => post('/api/tasks/bulk', { ids, action: { type: 'status', status: 'done' } })
    await bulk([first.body.id, foreign.body.id]).expect(404)
    const history = (token = owner.token) => request(instance.app).get(`/api/tasks/${first.body.id}/history`)
      .auth(token, { type: 'bearer' })
    const initial = await history().expect(200)
    expect(initial.body.map((entry: { action: string }) => entry.action)).toEqual(['created'])
    await bulk([first.body.id, second.body.id]).expect(204)
    const changed = await history().expect(200)
    expect(changed.body[0]).toMatchObject({ action: 'updated', fields: ['status'] })
    await history(other.token).expect(404)
    await post('/api/tasks/bulk', { ids: [first.body.id, second.body.id], action: { type: 'delete' } }).expect(204)
    const deleted = await history().expect(200)
    expect(deleted.body[0]).toMatchObject({ action: 'deleted' })
  })

  it('aggregates only the owner’s activity in the requested timezone and tracks deadline updates', async () => {
    const owner = await register()
    const other = await register('other@example.com')
    const add = (token: string, title: string) => request(instance.app).post('/api/tasks')
      .set('Origin', config.origin).auth(token, { type: 'bearer' })
      .send({ title, dueOn: '2020-01-01', priority: 'urgent' }).expect(201)
    const task = await add(owner.token, 'Owner deadline')
    await add(other.token, 'Foreign deadline')
    const path = '/api/tasks/' + task.body.id
    const patch = (token: string, body: object) => request(instance.app).patch(path)
      .set('Origin', config.origin).auth(token, { type: 'bearer' }).send(body)
    await patch(other.token, { dueOn: '2020-01-02' }).expect(404)
    await patch(owner.token, { dueOn: '2020-01-02' }).expect(200)
    const get = (token: string, query: string) => request(instance.app).get('/api/analytics?' + query)
      .auth(token, { type: 'bearer' })
    const overdue = await get(owner.token, 'days=7&zone=Asia%2FAlmaty').expect(200)
    expect(overdue.body).toMatchObject({ created: 1, completed: 0, overdue: 1,
      overdueTasks: [{ id: task.body.id, title: 'Owner deadline', dueOn: '2020-01-02' }] })
    await patch(owner.token, { status: 'done' }).expect(200)
    const summary = await get(owner.token, 'days=7&zone=America%2FNew_York').expect(200)
    expect(summary.body).toMatchObject({ created: 1, completed: 1, currentTotal: 1, currentDone: 1,
      statuses: { done: 1 }, priorities: { urgent: 1 }, overdue: 0 })
    expect(summary.body.activity).toHaveLength(7)
    expect(summary.body.activity.at(-1)).toMatchObject({ created: 1, completed: 1 })
    await get(owner.token, 'days=15').expect(400)
    await get(owner.token, 'zone=Invalid%2FZone').expect(400)
    await request(instance.app).get('/api/analytics').expect(401)
  })
})
