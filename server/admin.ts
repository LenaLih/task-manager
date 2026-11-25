import type { Express } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'

const sortColumns = {
  name: 'lower(u.name)', email: 'lower(u.email)', registeredAt: 'coalesce(u.registered_at, u.registration_known_by)',
  lastActiveAt: 'u.last_active_at', tasks: 'tasks', completed: 'completed',
  projects: 'projects', role: 'u.role',
}
const listInput = z.object({
  search: z.string().trim().max(254).default(''),
  sort: z.enum(['name', 'email', 'registeredAt', 'lastActiveAt', 'tasks', 'completed', 'projects', 'role']).default('registeredAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
})

export function addAdminRoutes(app: Express, pool: Pool) {
  app.use('/api/admin', async (_req, res, next) => {
    const { rows } = await pool.query('SELECT role FROM public.users WHERE id = $1', [res.locals.userId])
    if (rows[0]?.role !== 'admin') {
      res.status(403).json({ message: 'Administrator access required' })
      return
    }
    next()
  })

  app.get('/api/admin/overview', async (req, res) => {
    const days = req.query.days ?? '30'
    if (days !== '30' && days !== '90') {
      res.status(400).json({ message: 'Invalid chart period' })
      return
    }
    const { rows: [stats] } = await pool.query(`
      WITH calendar AS (
        SELECT (now() AT TIME ZONE 'UTC')::date AS today
      ), daily AS (
        SELECT (registered_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS count
        FROM public.users CROSS JOIN calendar
        WHERE registered_at >= ((today - ($1::int - 1))::timestamp AT TIME ZONE 'UTC')
          AND registered_at < ((today + 1)::timestamp AT TIME ZONE 'UTC')
        GROUP BY 1
      )
      SELECT count(*)::int AS users,
        count(*) FILTER (WHERE registered_at >= today::timestamp AT TIME ZONE 'UTC')::int AS "registeredToday",
        count(*) FILTER (WHERE registered_at >= (today - 6)::timestamp AT TIME ZONE 'UTC')::int AS "registered7",
        count(*) FILTER (WHERE registered_at >= (today - 29)::timestamp AT TIME ZONE 'UTC')::int AS "registered30",
        count(*) FILTER (WHERE last_active_at >= now() - interval '168 hours')::int AS "active7",
        count(*) FILTER (WHERE last_active_at >= now() - interval '720 hours')::int AS "active30",
        (SELECT count(*)::int FROM public.projects) AS projects,
        (SELECT count(*)::int FROM public.tasks) AS tasks,
        (SELECT count(*)::int FROM public.tasks WHERE completed) AS completed,
        (SELECT applied_at FROM public.schema_migrations WHERE name = '009_admin_dashboard.sql') AS "trackingSince",
        (SELECT json_agg(json_build_object('day', to_char(c.today - offset_day, 'YYYY-MM-DD'),
            'count', CASE WHEN c.today - offset_day >= (
              SELECT (applied_at AT TIME ZONE 'UTC')::date FROM public.schema_migrations WHERE name = '009_admin_dashboard.sql'
            ) THEN coalesce(daily.count, 0) END) ORDER BY offset_day DESC)
         FROM calendar c CROSS JOIN generate_series(0, $1::int - 1) AS days(offset_day)
         LEFT JOIN daily ON daily.day = c.today - offset_day) AS registrations
      FROM public.users CROSS JOIN calendar
    `, [days])
    res.json(stats)
  })

  app.get('/api/admin/users', async (req, res) => {
    const parsed = listInput.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ message: 'Invalid table parameters' })
      return
    }
    const { search, sort, direction, page, size } = parsed.data
    const order = `${sortColumns[sort]} ${direction} NULLS LAST, u.id`
    const { rows: [result] } = await pool.query(`
      WITH matching AS (
        SELECT id, name, email, registered_at, registration_known_by, last_active_at, role
        FROM public.users
        WHERE $1 = '' OR strpos(lower(name), lower($1)) > 0 OR strpos(lower(email), lower($1)) > 0
      ), selected AS (
        SELECT u.name, u.email, u.registered_at AS "registeredAt", u.registration_known_by AS "registrationKnownBy",
          u.last_active_at AS "lastActiveAt", u.role,
          task_counts.tasks, task_counts.completed, project_counts.projects,
          row_number() OVER (ORDER BY ${order}) AS position
        FROM matching u
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS tasks, count(*) FILTER (WHERE completed)::int AS completed
          FROM public.tasks WHERE user_id = u.id
        ) task_counts
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS projects FROM public.projects WHERE user_id = u.id
        ) project_counts
        ORDER BY ${order} LIMIT $2 OFFSET $3
      )
      SELECT (SELECT count(*)::int FROM matching) AS total,
        coalesce(json_agg(to_jsonb(selected) - 'position' ORDER BY position), '[]') AS users
      FROM selected
    `, [search, size, (page - 1) * size])
    res.json(result)
  })
}
