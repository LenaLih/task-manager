ALTER TABLE public.users
  ADD COLUMN name TEXT NOT NULL DEFAULT '',
  ADD COLUMN theme TEXT CHECK (theme IN ('light', 'dark')),
  ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 0 CHECK (reminder_days IN (0, 1, 3, 7));

ALTER TABLE public.sessions
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN device TEXT NOT NULL DEFAULT '';

CREATE INDEX sessions_user ON public.sessions(user_id);

CREATE TABLE public.email_changes (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE public.saved_filters (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  PRIMARY KEY (user_id, name)
);
