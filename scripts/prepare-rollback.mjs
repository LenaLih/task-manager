import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const fallbackBase = 'e823e854bc20d0274e162952001112e9d1afc44d'
const compatibility = {
  '002_password_resets.sql': 'b77061fec102ee768600f0a78c13ddf8ad12afe0d4c787f8b27a45f36a088e63',
  '003_task_details.sql': '3191c2414a1695b66253a9e0f94182abed3dd85e8b15304bfe80392e90f5b13d',
  '004_projects_and_task_history.sql': '0fddab06f8f5000112f936f936c34e8c232aed7876da0b588553b25f35d26b8c',
  '005_completion_analytics.sql': '6deea6985d7c07b702fdab3c49595228c050231b9b6f57dce158b76d34b8362a',
  '006_accounts.sql': '00501b7da4a566d47872017aa5c753a8779b826707f9b4b026a1a150f6cdd2c2',
  '007_finance.sql': '94eb25f324c7d95a19f2d4e210447c2d645bc27feb8b282abd776cde5284573d',
}
for (const [name, expected] of Object.entries(compatibility)) {
  const sql = readFileSync(join('migrations', name), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (createHash('sha256').update(sql).digest('hex') !== expected) {
    throw Error('Rollback compatibility must be revalidated for ' + name)
  }
}
mkdirSync('test-results', { recursive: true })
const output = mkdtempSync(join('test-results', 'release-rollback-'))
const archive = join(output, 'base.tar')
execFileSync('git', ['archive', '--format=tar', '--output', archive, fallbackBase])
execFileSync('tar', ['-xf', archive, '-C', output])
unlinkSync(archive)

function update(file, transform) {
  const destination = join(output, file)
  const source = readFileSync(destination, 'utf8').replace(/\r\n/g, '\n')
  writeFileSync(destination, transform(source))
}
function replace(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Unexpected fallback source: ' + before)
  return source.replace(before, after)
}

for (const file of ['server/migrate.ts', 'package.json', 'package-lock.json']) {
  copyFileSync(file, join(output, file))
}
update('server/migrate-cli.ts', source => replace(source, 'await runMigrations(pool)',
  'await runMigrations(pool, { compatibleNewer: ' + JSON.stringify(compatibility, null, 2) + ' })'))
update('server/app.ts', source => {
  const insert = replace(source,
    'INSERT INTO public.tasks (id, user_id, title, completed) VALUES ($1, $2, $3, $4)',
    "INSERT INTO public.tasks (id, user_id, title, completed, status) VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN 'done' ELSE 'todo' END)")
  return replace(insert, 'SET title = COALESCE($1::text, title), completed = COALESCE($2::boolean, completed)',
    "SET title = COALESCE($1::text, title), completed = COALESCE($2::boolean, completed),\n           status = CASE WHEN $2::boolean THEN 'done' WHEN $2::boolean = false AND completed THEN 'todo' ELSE status END")
})
console.log(output)
