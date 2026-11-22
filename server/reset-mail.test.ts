import nodemailer from 'nodemailer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createResetMailer } from './reset-mail'

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }))

describe('password reset mail configuration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('disables delivery by default and rejects local mode in production', () => {
    expect(createResetMailer({}, 'http://localhost:3000')).toBeUndefined()
    expect(() => createResetMailer({
      RESET_MAIL_MODE: 'local', NODE_ENV: 'production',
    }, 'https://tasks.example.test')).toThrow('development only')
    expect(nodemailer.createTransport).not.toHaveBeenCalled()
  })

  it('uses the loopback SMTP sink without credentials and a test envelope', async () => {
    const send = createResetMailer({
      RESET_MAIL_MODE: 'local', SMTP_HOST: 'smtp.example.test',
    }, 'http://localhost:3000')
    const link = 'http://localhost:3000/reset-password#token=example'
    await send?.('user@example.test', link)
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: '127.0.0.1', port: 1025, auth: undefined,
    }))
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      envelope: { from: 'task-manager@example.test', to: 'mailbox@example.test' },
      to: 'user@example.test',
      text: expect.stringContaining(link),
    }))
  })

  it('requires an HTTPS application origin and SMTP credentials for real mail', () => {
    const config = {
      RESET_MAIL_MODE: 'smtp', SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'tasks@example.test', SMTP_USER: 'test-user', SMTP_PASSWORD: 'test-only',
    }
    expect(() => createResetMailer(config, 'http://localhost:3000')).toThrow('Invalid APP_ORIGIN')
    expect(() => createResetMailer({ ...config, SMTP_PASSWORD: '' }, 'https://tasks.example.test'))
      .toThrow('Incomplete SMTP configuration')
    expect(createResetMailer(config, 'https://tasks.example.test')).toBeTypeOf('function')
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 587, secure: false, requireTLS: true,
    }))
  })

  it('uses the same local transport for the email-change code and sends it without a URL', async () => {
    const send = createResetMailer({ RESET_MAIL_MODE: 'local' }, 'http://localhost:3000')
    const code = 'a'.repeat(43)
    await send?.('new@example.test', code, 'email-change')
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: 'new@example.test', subject: 'Подтверждение нового email — Ясно.',
      envelope: { from: 'task-manager@example.test', to: 'mailbox@example.test' },
    })
    expect(sendMail.mock.calls[0][0].text).toContain(code)
    expect(sendMail.mock.calls[0][0].text).not.toMatch(/https?:/)
  })
})

describe('Mailjet Send API', () => {
  const env = { RESET_MAIL_MODE: 'mailjet', MAILJET_API_KEY: 'fake-key', MAILJET_SECRET_KEY: 'fake-secret' }
  const origin = 'http://localhost:3000'
  const recipient = 'recipient@example.test'
  const link = origin + '/reset-password#token=simulated-token'

  afterEach(() => vi.unstubAllGlobals())

  it('requires both keys and allows a loopback HTTP origin only in development', () => {
    expect(() => createResetMailer({ ...env, MAILJET_API_KEY: '' }, origin)).toThrow('Incomplete Mailjet configuration')
    expect(() => createResetMailer({ ...env, MAILJET_SECRET_KEY: ' ' }, origin)).toThrow('Incomplete Mailjet configuration')
    expect(() => createResetMailer(env, 'http://tasks.example.test')).toThrow('Invalid APP_ORIGIN')
    expect(() => createResetMailer({ ...env, NODE_ENV: 'production' }, origin)).toThrow('Invalid APP_ORIGIN')
    expect(createResetMailer({ ...env, NODE_ENV: 'production' }, 'https://tasks.example.test')).toBeTypeOf('function')
  })

  it('sends both existing templates with Basic auth and tracking disabled', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ Messages: [{ Status: 'success' }] }))
    vi.stubGlobal('fetch', request)
    const send = createResetMailer(env, origin)!
    const code = 'a'.repeat(43)
    await send(recipient, link)
    await send(recipient, code, 'email-change')

    expect(request).toHaveBeenCalledTimes(2)
    for (const [url, options] of request.mock.calls) {
      expect(url).toBe('https://api.mailjet.com/v3.1/send')
      expect(options).toMatchObject({
        method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
        headers: { Authorization: 'Basic ' + Buffer.from('fake-key:fake-secret').toString('base64'), 'Content-Type': 'application/json' },
      })
      expect(JSON.parse(String(options?.body))).toMatchObject({
        Messages: [{
          From: { Email: 'yasno.support@gmail.com', Name: 'ЯСНО.' },
          To: [{ Email: recipient }],
          TrackOpens: 'disabled',
          TrackClicks: 'disabled',
        }],
      })
    }
    const [reset, confirmation] = request.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).Messages[0])
    expect(reset).toMatchObject({ Subject: 'Восстановление пароля Task Manager', TextPart: expect.stringContaining(link) })
    expect(confirmation).toMatchObject({ Subject: 'Подтверждение нового email — Ясно.', TextPart: expect.stringContaining(code) })
    expect(confirmation.TextPart).not.toMatch(/https?:/)
  })

  it.each([
    [429, 'Mailjet sending limit reached (HTTP 429)'],
    [403, 'Mailjet request rejected (HTTP 403)'],
    [503, 'Mailjet request rejected (HTTP 503)'],
  ])('handles HTTP %i without exposing the response or retrying', async (status, message) => {
    const request = vi.fn(async () => new Response(link, { status }))
    vi.stubGlobal('fetch', request)
    await expect(createResetMailer(env, origin)!(recipient, link)).rejects.toEqual(new Error(message))
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects message errors even on HTTP 200 without exposing Mailjet details', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ Messages: [{ Status: 'error', Errors: [{ ErrorMessage: link }] }] }))
    await expect(createResetMailer(env, origin)!(recipient, link)).rejects.toEqual(new Error('Mailjet did not accept the message'))
  })

  it('rejects an invalid response without exposing the body', async () => {
    vi.stubGlobal('fetch', async () => new Response(link))
    await expect(createResetMailer(env, origin)!(recipient, link)).rejects.toEqual(new Error('Invalid Mailjet response'))
  })

  it('sanitizes network errors and bounds the request with a ten-second timeout', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError(link) })
    await expect(createResetMailer(env, origin)!(recipient, link)).rejects.toEqual(new Error('Mailjet network request failed'))
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    await expect(createResetMailer(env, origin)!(recipient, link)).rejects.toEqual(new Error('Mailjet request timed out'))
    expect(timeout).toHaveBeenCalledWith(10_000)
  })
})
