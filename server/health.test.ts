import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Pool } from 'pg'
import { createApp } from './app'

const config = {
  accessSecret: 'health-test-access-'.repeat(3),
  refreshSecret: 'health-test-refresh-'.repeat(3),
  origin: 'https://tasks.example.com',
  production: true,
}

describe('production HTTP infrastructure', () => {
  it('healthcheck exposes only status and never queries PostgreSQL', async () => {
    const query = vi.fn()
    const { app } = createApp(config, { query } as unknown as Pool)
    const response = await request(app).get('/api/health').expect(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(query).not.toHaveBeenCalled()
    const privateResponse = await request(app).get('/api/tasks').expect(401)
    expect(privateResponse.headers['cache-control']).toBe('no-store')
  })

  it('trusts only the immediate loopback proxy', () => {
    const { app } = createApp(config, {} as Pool)
    const trust = app.get('trust proxy') as (address: string, hop: number) => boolean
    expect(trust('127.0.0.1', 0)).toBe(true)
    expect(trust('127.0.0.1', 1)).toBe(false)
    expect(trust('203.0.113.1', 0)).toBe(false)
  })

  it('rate limits a forwarded address despite changes to untrusted leading hops', async () => {
    const { app } = createApp(config, {} as Pool)
    for (let i = 0; i < 30; i++) {
      await request(app).post('/api/auth/login')
        .set('Origin', config.origin)
        .set('X-Forwarded-For', `198.51.100.${i + 1}, 203.0.113.10`)
        .send({}).expect(400)
    }
    await request(app).post('/api/auth/login').set('Origin', config.origin)
      .set('X-Forwarded-For', '198.51.100.99, 203.0.113.10').send({}).expect(429)
    await request(app).post('/api/auth/login').set('Origin', config.origin)
      .set('X-Forwarded-For', '203.0.113.11').send({}).expect(400)
  })
})
