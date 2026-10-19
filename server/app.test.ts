import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { createApp } from './app'
const config = { database: ':memory:', accessSecret: 'test-access-secret-'.repeat(3), refreshSecret: 'test-refresh-secret-'.repeat(3), origin: 'http://localhost:5173', production: false }
let instance: ReturnType<typeof createApp>
beforeEach(() => { instance = createApp(config) })
afterEach(() => { instance.db.close() })
const password = 'test-password-123'
async function register(email = 'one@example.com') {
  const response = await request(instance.app).post('/api/auth/register').set('Origin', config.origin).send({ email, password }).expect(201)
  return { token: String(response.body.accessToken), cookie: response.headers['set-cookie'] as unknown as string[], id: String(response.body.user.id) }
}
describe('auth and task API', () => {
  it('requires secure cookies in production and rejects unsafe configuration', async () => {
    expect(() => createApp({ ...config, accessSecret: 'short' })).toThrow()
    expect(() => createApp({ ...config, refreshSecret: config.accessSecret })).toThrow()
    instance.db.close()
    instance = createApp({ ...config, production: true })
    const user = await register()
    expect(user.cookie[0]).toContain('Secure')
  })
  it('hashes passwords, sets protected cookie, logs in and rejects duplicates / wrong password', async () => {
    const user = await register()
    expect(user.cookie[0]).toContain('HttpOnly')
    expect(user.cookie[0]).toContain('SameSite=Strict')
    const row = instance.db.prepare('SELECT password FROM users WHERE id = ?').get(user.id) as { password: string }
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
})
