ALTER TABLE public.users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  ADD COLUMN registered_at TIMESTAMPTZ,
  ADD COLUMN registration_known_by TIMESTAMPTZ,
  ADD COLUMN last_active_at TIMESTAMPTZ;

-- An event establishes that the account existed by then. It does not date signup.
WITH evidence AS (
  SELECT user_id, min(occurred_at) AS known_by FROM public.task_history GROUP BY user_id
  UNION ALL
  SELECT user_id, min(created_at) FROM public.sessions GROUP BY user_id
), earliest AS (
  SELECT user_id, min(known_by) AS known_by FROM evidence GROUP BY user_id
)
UPDATE public.users u SET registration_known_by = earliest.known_by
FROM earliest WHERE earliest.user_id = u.id;

ALTER TABLE public.users ALTER COLUMN registered_at SET DEFAULT now();
CREATE INDEX users_registered_at ON public.users(registered_at) WHERE registered_at IS NOT NULL;
