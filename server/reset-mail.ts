import nodemailer from 'nodemailer'
import { z } from 'zod'
import type { SendResetMail } from './password-reset.js'

const mailjetEndpoint = 'https://api.mailjet.com/v3.1/send'
const acceptedMessage = z.object({ Messages: z.tuple([z.object({ Status: z.literal('success') })]) })

function mailContent(content: string, purpose: Parameters<SendResetMail>[2]) {
  return {
    subject: purpose ? 'Подтверждение нового email — Ясно.' : 'Восстановление пароля Task Manager',
    text: purpose
      ? `Введите этот код в настройках аккаунта:\n\n${content}\n\nКод действует 15 минут. Если вы не запрашивали смену адреса, проигнорируйте письмо.`
      : `Откройте ссылку, чтобы задать новый пароль:\n\n${content}\n\nСсылка действует 15 минут. Если вы не запрашивали сброс, проигнорируйте письмо.`,
  }
}

function createMailjetMailer(env: NodeJS.ProcessEnv): SendResetMail {
  const key = env.MAILJET_API_KEY?.trim()
  const secret = env.MAILJET_SECRET_KEY?.trim()
  if (!key || !secret) throw new Error('Incomplete Mailjet configuration')
  const authorization = 'Basic ' + Buffer.from(`${key}:${secret}`, 'utf8').toString('base64')

  return async (email, content, purpose) => {
    const { subject, text } = mailContent(content, purpose)
    const signal = AbortSignal.timeout(10_000)
    let response: Response
    try {
      response = await fetch(mailjetEndpoint, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Messages: [{
            From: { Email: 'yasno.support@gmail.com', Name: 'ЯСНО.' },
            To: [{ Email: email }],
            Subject: subject,
            TextPart: text,
            TrackOpens: 'disabled',
            TrackClicks: 'disabled',
          }],
        }),
      })
    } catch {
      throw new Error(signal.aborted ? 'Mailjet request timed out' : 'Mailjet network request failed')
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      if (response.status === 429) throw new Error('Mailjet sending limit reached (HTTP 429)')
      throw new Error(`Mailjet request rejected (HTTP ${response.status})`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(signal.aborted ? 'Mailjet request timed out' : 'Invalid Mailjet response')
    }
    // Mailjet reports message-level errors separately from the HTTP status.
    if (!acceptedMessage.safeParse(payload).success) throw new Error('Mailjet did not accept the message')
  }
}

export function createResetMailer(
  env: NodeJS.ProcessEnv, appOrigin: string,
): SendResetMail | undefined {
  const mode = env.RESET_MAIL_MODE || 'disabled'
  if (mode === 'disabled') return undefined
  if (mode !== 'local' && mode !== 'smtp' && mode !== 'mailjet') throw new Error('Invalid RESET_MAIL_MODE')
  const local = mode === 'local'
  if (local && env.NODE_ENV === 'production') throw new Error('Local mail is development only')
  const origin = new URL(appOrigin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  const developmentMailjet = mode === 'mailjet' && env.NODE_ENV !== 'production' &&
    loopback && origin.protocol === 'http:'
  if (origin.origin !== appOrigin || (local ? !loopback : origin.protocol !== 'https:' && !developmentMailjet)) {
    throw new Error('Invalid APP_ORIGIN for password reset mail')
  }
  if (mode === 'mailjet') return createMailjetMailer(env)

  const host = local ? '127.0.0.1' : env.SMTP_HOST
  const port = Number(env.SMTP_PORT || (local ? '1025' : '587'))
  const from = local ? 'task-manager@example.test' : env.SMTP_FROM
  const user = env.SMTP_USER
  const pass = env.SMTP_PASSWORD
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 ||
      (!local && (!user || !pass))) {
    throw new Error('Incomplete SMTP configuration')
  }

  const transport = nodemailer.createTransport({
    host, port,
    secure: !local && port === 465,
    requireTLS: !local && port !== 465,
    ignoreTLS: local,
    auth: local ? undefined : { user, pass },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  })
  return async (email, content, purpose) => {
    await transport.sendMail({
      from,
      to: email,
      envelope: local ? { from, to: 'mailbox@example.test' } : undefined,
      ...mailContent(content, purpose),
    })
  }
}
