import type { Express } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'

const options = z.object({
  days: z.enum(['7', '30', '90']).default('30'),
  zone: z.string().max(100).default('UTC'),
})

export function addAnalyticsRoutes(app: Express, pool: Pool) {
  app.get('/api/analytics', async (req, res) => {
    const parsed = options.safeParse(req.query)
    if (!parsed.success) { res.status(400).json({ message: 'Проверьте период и часовой пояс' }); return }
    const { days, zone } = parsed.data
    const timezone = await pool.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [zone])
    if (!timezone.rowCount) { res.status(400).json({ message: 'Неизвестный часовой пояс' }); return }

    const { rows: [result] } = await pool.query(`
      WITH bounds AS (
        SELECT (CURRENT_TIMESTAMP AT TIME ZONE $2)::date AS today
      ), period AS (
        SELECT today, today - ($3::int - 1) AS since FROM bounds
      ), events AS (
        SELECT task_id, action, resulting_status, (occurred_at AT TIME ZONE $2)::date AS day
        FROM public.task_history CROSS JOIN period
        WHERE user_id = $1 AND occurred_at >= (since::timestamp AT TIME ZONE $2)
          AND occurred_at < ((today + 1)::timestamp AT TIME ZONE $2)
      ), daily AS (
        SELECT day, count(*) FILTER (WHERE action = 'created')::int AS created,
          count(*) FILTER (WHERE resulting_status = 'done')::int AS completed
        FROM events GROUP BY day
      ), owned AS (
        SELECT id, title, project_id, completed, status, priority, due_on FROM public.tasks WHERE user_id = $1
      ), project_stats AS (
        SELECT p.id, p.name, p.archived, count(t.id)::int AS total,
          count(t.id) FILTER (WHERE t.completed)::int AS done
        FROM public.projects p LEFT JOIN owned t ON t.project_id = p.id
        WHERE p.user_id = $1 GROUP BY p.id
      )
      SELECT
        (SELECT count(*)::int FROM events WHERE action = 'created') AS created,
        (SELECT count(DISTINCT task_id)::int FROM events WHERE resulting_status = 'done') AS completed,
        (SELECT count(DISTINCT task_id)::int FROM events JOIN owned ON owned.id = events.task_id
          WHERE action = 'created' AND owned.completed) AS "createdDone",
        (SELECT count(*)::int FROM owned WHERE completed) AS "currentDone",
        (SELECT count(*)::int FROM owned) AS "currentTotal",
        (SELECT count(*)::int FROM owned CROSS JOIN period WHERE NOT completed AND due_on < today) AS overdue,
        (SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item."dueOn", item.id), '[]') FROM (
          SELECT id, title, to_char(due_on, 'YYYY-MM-DD') AS "dueOn"
          FROM owned CROSS JOIN period WHERE NOT completed AND due_on < today ORDER BY due_on, id LIMIT 10
        ) item) AS "overdueTasks",
        (SELECT jsonb_agg(jsonb_build_object('date', to_char(since + n, 'YYYY-MM-DD'),
          'created', coalesce(d.created, 0), 'completed', coalesce(d.completed, 0)) ORDER BY n)
          FROM period CROSS JOIN generate_series(0, $3::int - 1) AS series(n)
          LEFT JOIN daily d ON d.day = since + n) AS activity,
        (SELECT coalesce(jsonb_object_agg(status, total), '{}')
          FROM (SELECT status, count(*)::int AS total FROM owned GROUP BY status) s) AS statuses,
        (SELECT coalesce(jsonb_object_agg(priority, total), '{}')
          FROM (SELECT priority, count(*)::int AS total FROM owned GROUP BY priority) p) AS priorities,
        (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY archived, name, id), '[]') FROM project_stats p) AS projects
    `, [res.locals.userId, zone, days])
    res.json(result)
  })
}
