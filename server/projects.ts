import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'

const project = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional(),
  color: z.enum(['green', 'blue', 'purple', 'amber']).optional(),
  icon: z.enum(['folder', 'flag', 'bolt', 'star']).optional(),
}).strict()
const changes = project.extend({ archived: z.boolean() }).partial()
  .refine(value => Object.keys(value).length > 0)

export function addProjectRoutes(app: Express, pool: Pool) {
  const summary = `SELECT p.id, p.name, p.description, p.color, p.icon, p.archived,
     count(t.id)::int AS total, count(t.id) FILTER (WHERE t.completed)::int AS done
    FROM public.projects p LEFT JOIN public.tasks t ON (t.user_id, t.project_id) = (p.user_id, p.id)
    WHERE p.user_id = $1`

  app.get('/api/projects', async (_req, res) => {
    const { rows } = await pool.query(`${summary} GROUP BY p.id ORDER BY p.archived, p.name, p.id`, [res.locals.userId])
    res.json(rows)
  })
  app.get('/api/projects/:id', async (req, res) => {
    const { rows: [row] } = await pool.query(`${summary} AND p.id = $2 GROUP BY p.id`, [res.locals.userId, req.params.id])
    if (!row) { res.status(404).json({ message: 'Проект не найден' }); return }
    res.json(row)
  })
  app.post('/api/projects', async (req, res) => {
    const parsed = project.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ message: 'Проверьте параметры проекта' }); return }
    const { name, description = '', color = 'green', icon = 'folder' } = parsed.data
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.projects (id, user_id, name, description, color, icon)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, color, icon, archived, 0 AS total, 0 AS done`,
      [randomUUID(), res.locals.userId, name, description, color, icon],
    )
    res.status(201).json(row)
  })
  app.patch('/api/projects/:id', async (req, res) => {
    const parsed = changes.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ message: 'Проверьте параметры проекта' }); return }
    const { name, description, color, icon, archived } = parsed.data
    const result = await pool.query(
      `UPDATE public.projects SET name = COALESCE($1, name), description = COALESCE($2, description),
         color = COALESCE($3, color), icon = COALESCE($4, icon), archived = COALESCE($5, archived)
       WHERE user_id = $6 AND id = $7`,
      [name, description, color, icon, archived, res.locals.userId, req.params.id],
    )
    if (!result.rowCount) { res.status(404).json({ message: 'Проект не найден' }); return }
    res.status(204).end()
  })
}
