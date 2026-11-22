import type { Express, Request, Response } from 'express'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { withTransaction } from './db.js'

const id = z.uuid()
const currency = z.enum(['KGS', 'RUB', 'USD'])
const name = z.string().trim().min(1).max(80).refine(value => !value.includes('\0'))
const amount = z.string().regex(/^[1-9]\d{0,14}$/)
const opening = z.string().regex(/^(?:0|-?[1-9]\d{0,14})$/)
const day = z.iso.date().refine(value => !value.startsWith('0000'))
const account = z.object({ name, kind: z.enum(['cash', 'bank', 'card', 'savings']), opening, currency }).strict()
const common = { accountId: id, amount, day, note: z.string().max(500).refine(value => !value.includes('\0')) }
const entry = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('income'), category: name }).strict(),
  z.object({ ...common, kind: z.literal('expense'), category: name }).strict(),
  z.object({ ...common, kind: z.literal('transfer'), destinationId: id, goalId: id.optional() }).strict(),
])
const budget = z.object({ category: name, currency, month: day.refine(value => value.endsWith('-01')), amount }).strict()
const goal = z.object({ name, accountId: id, target: amount, deadline: day.nullable() }).strict()

class FinanceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new FinanceError(400, 'Проверьте поля формы.')
  return result.data
}

const snapshot = `
  SELECT
    ARRAY(SELECT jsonb_build_object('id', id, 'name', name, 'kind', kind, 'currency', currency,
      'opening', opening::text, 'archived', archived)
      FROM public.finance_accounts WHERE user_id = $1 ORDER BY archived, name, id) AS accounts,
    ARRAY(SELECT jsonb_build_object('id', id, 'accountId', account_id, 'destinationId', destination_id,
      'goalId', goal_id, 'currency', currency, 'kind', kind, 'amount', amount::text,
      'day', to_char(day,'YYYY-MM-DD'), 'category', category, 'note', note)
      FROM public.finance_entries WHERE user_id = $1 ORDER BY day DESC, id) AS entries,
    ARRAY(SELECT jsonb_build_object('id', id, 'category', category, 'currency', currency,
      'month', to_char(month,'YYYY-MM-DD'), 'amount', amount::text)
      FROM public.finance_budgets WHERE user_id = $1 ORDER BY month DESC, category, id) AS budgets,
    ARRAY(SELECT jsonb_build_object('id', id, 'name', name, 'accountId', account_id, 'currency', currency,
      'target', target::text, 'deadline', to_char(deadline,'YYYY-MM-DD'))
      FROM public.finance_goals WHERE user_id = $1 ORDER BY name, id) AS goals
`

export function addFinanceRoutes(app: Express, pool: Pool) {
  const root = '/api/finance'
  app.get(root, async (_req, res) => {
    const { rows: [data] } = await pool.query(snapshot, [res.locals.userId])
    res.json(data)
  })

  function write(operation: (client: PoolClient, owner: string, req: Request) => Promise<void>) {
    return async (req: Request, res: Response) => {
      try {
        await withTransaction(pool, async client => {
          const owner: string = res.locals.userId
          // Serialize mutations for one ledger, including archive and transfer validation.
          await client.query('SELECT id FROM public.users WHERE id = $1 FOR UPDATE', [owner])
          const active = await client.query(
            'SELECT 1 FROM public.sessions WHERE id=$1 AND user_id=$2 AND expires>$3',
            [res.locals.sessionId, owner, Date.now()],
          )
          if (!active.rowCount) throw new FinanceError(401, 'Сессия завершена.')
          await operation(client, owner, req)
        })
        res.status(204).end()
      } catch (error) {
        if (error instanceof FinanceError) { res.status(error.status).json({ message: error.message }); return }
        if (error instanceof Error && 'code' in error && error.code === '23505') {
          res.status(409).json({ message: 'Эта запись или бюджет для этой категории уже существует.' }); return
        }
        throw error
      }
    }
  }

  async function ownedAccount(client: PoolClient, owner: string, accountId: string) {
    const { rows: [row] } = await client.query<{ currency: string; archived: boolean }>(
      'SELECT currency, archived FROM public.finance_accounts WHERE user_id = $1 AND id = $2', [owner, accountId],
    )
    if (!row) throw new FinanceError(404, 'Счёт недоступен.')
    return row
  }

  app.put(root + '/accounts/:id', write(async (client, owner, req) => {
    const accountId = parse(id, req.params.id)
    const data = parse(account, req.body)
    const result = await client.query(
      `INSERT INTO public.finance_accounts (user_id,id,name,kind,currency,opening) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id,id) DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,
       opening=EXCLUDED.opening
       WHERE finance_accounts.currency=EXCLUDED.currency`,
      [owner, accountId, data.name, data.kind, data.currency, data.opening],
    )
    if (!result.rowCount) throw new FinanceError(409, 'Валюта существующего счёта фиксирована.')
  }))

  app.patch(root + '/accounts/:id', write(async (client, owner, req) => {
    const { archived } = parse(z.object({ archived: z.boolean() }).strict(), req.body)
    const result = await client.query('UPDATE public.finance_accounts SET archived=$3 WHERE user_id=$1 AND id=$2',
      [owner, parse(id, req.params.id), archived])
    if (!result.rowCount) throw new FinanceError(404, 'Счёт недоступен.')
  }))

  app.put(root + '/entries/:id', write(async (client, owner, req) => {
    const entryId = parse(id, req.params.id)
    const data = parse(entry, req.body)
    const transfer = data.kind === 'transfer'
    const destinationId = transfer ? data.destinationId : null
    const goalId = transfer ? data.goalId ?? null : null
    const category = transfer ? null : data.category
    const { rows: [previous] } = await client.query<{ account_id: string; destination_id: string | null }>(
      'SELECT account_id, destination_id FROM public.finance_entries WHERE user_id=$1 AND id=$2', [owner, entryId],
    )
    const source = await ownedAccount(client, owner, data.accountId)
    if (source.archived && previous?.account_id !== data.accountId) throw new FinanceError(409, 'Счёт в архиве.')
    if (destinationId) {
      const destination = await ownedAccount(client, owner, destinationId)
      if (destinationId === data.accountId || destination.currency !== source.currency) {
        throw new FinanceError(400, 'Выберите два разных счёта в одной валюте.')
      }
      if (destination.archived && previous?.destination_id !== destinationId) throw new FinanceError(409, 'Счёт в архиве.')
    }
    if (goalId) {
      const result = await client.query(
        'SELECT 1 FROM public.finance_goals WHERE user_id=$1 AND id=$2 AND account_id=$3', [owner, goalId, destinationId],
      )
      if (!result.rowCount) throw new FinanceError(404, 'Цель недоступна для этого счёта.')
    }
    await client.query(
      `INSERT INTO public.finance_entries (user_id,id,account_id,destination_id,goal_id,currency,kind,amount,day,category,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id,id) DO UPDATE SET account_id=EXCLUDED.account_id,destination_id=EXCLUDED.destination_id,
       goal_id=EXCLUDED.goal_id,currency=EXCLUDED.currency,kind=EXCLUDED.kind,amount=EXCLUDED.amount,
       day=EXCLUDED.day,category=EXCLUDED.category,note=EXCLUDED.note`,
      [owner, entryId, data.accountId, destinationId, goalId, source.currency, data.kind, data.amount, data.day, category, data.note],
    )
  }))

  app.put(root + '/budgets/:id', write(async (client, owner, req) => {
    const data = parse(budget, req.body)
    await client.query(
      `INSERT INTO public.finance_budgets VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id,id) DO UPDATE SET category=EXCLUDED.category,currency=EXCLUDED.currency,
       month=EXCLUDED.month,amount=EXCLUDED.amount`,
      [owner, parse(id, req.params.id), data.category.toLocaleLowerCase('ru-RU'), data.currency, data.month, data.amount],
    )
  }))

  app.put(root + '/goals/:id', write(async (client, owner, req) => {
    const goalId = parse(id, req.params.id)
    const data = parse(goal, req.body)
    const linked = await ownedAccount(client, owner, data.accountId)
    if (linked.archived) {
      const existing = await client.query('SELECT 1 FROM public.finance_goals WHERE user_id=$1 AND id=$2 AND account_id=$3',
        [owner, goalId, data.accountId])
      if (!existing.rowCount) throw new FinanceError(409, 'Счёт в архиве.')
    }
    const result = await client.query(
      `INSERT INTO public.finance_goals VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id,id) DO UPDATE SET name=EXCLUDED.name,target=EXCLUDED.target,deadline=EXCLUDED.deadline
       WHERE finance_goals.account_id=EXCLUDED.account_id`,
      [owner, goalId, data.accountId, linked.currency, data.name, data.target, data.deadline],
    )
    if (!result.rowCount) throw new FinanceError(409, 'Счёт цели фиксирован.')
  }))

  for (const [resource, table] of [['entries', 'finance_entries'], ['budgets', 'finance_budgets']] as const) {
    app.delete(root + '/' + resource + '/:id', write(async (client, owner, req) => {
      const result = await client.query(`DELETE FROM public.${table} WHERE user_id=$1 AND id=$2`, [owner, parse(id, req.params.id)])
      if (!result.rowCount) throw new FinanceError(404, 'Запись недоступна.')
    }))
  }
}
