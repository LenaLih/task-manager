import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { smtpPort } from './settings'

export async function listenForEmailCode() {
  const sockets = new Set<Socket>()
  let code: string | undefined
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setEncoding('utf8')
    socket.write('220 localhost test SMTP\r\n')
    let input = ''
    let message: string[] | undefined
    socket.on('data', (chunk: string) => {
      input += chunk
      let newline = input.indexOf('\r\n')
      while (newline >= 0) {
        const line = input.slice(0, newline)
        input = input.slice(newline + 2)
        newline = input.indexOf('\r\n')
        if (message && line !== '.') {
          message.push(line)
        } else if (message) {
          const separator = message.indexOf('')
          const headers = message.slice(0, separator).join('\n')
          const content = message.slice(separator + 1).join('\n')
          const text = /Content-Transfer-Encoding: base64/i.test(headers)
            ? Buffer.from(content, 'base64').toString('utf8') : content.replaceAll('=\n', '')
          code = text.match(/^[A-Za-z0-9_-]{43}$/m)?.[0]
            ?? text.match(/\/reset-password#token=(?:3D)?([A-Za-z0-9_-]{43})\b/)?.[1]
          message = undefined
          socket.write('250 Accepted\r\n')
        } else if (line === 'DATA') {
          message = []
          socket.write('354 End with a dot\r\n')
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n')
        } else {
          socket.write('250 localhost\r\n')
        }
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(smtpPort, '127.0.0.1', resolve)
  })
  return {
    takeCode() {
      const received = code
      code = undefined
      return received
    },
    close() {
      for (const socket of sockets) socket.destroy()
      return new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
