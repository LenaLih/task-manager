import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
try {
  writeFileSync('.env', [
    '# Generated local development settings; never commit this file.',
    `JWT_ACCESS_SECRET=${randomBytes(48).toString('hex')}`,
    `JWT_REFRESH_SECRET=${randomBytes(48).toString('hex')}`,
    'DATABASE_PATH=./data/tasks.sqlite', 'PORT=3001',
    'APP_ORIGIN=http://localhost:5173', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 })
  console.log('Created local .env with random development secrets.')
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'EEXIST') console.log('.env exists; kept existing settings.')
  else throw error
}
