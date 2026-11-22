ALTER TABLE public.tasks
  ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 3000),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in-progress', 'done')),
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  ADD COLUMN starts_on DATE,
  ADD COLUMN due_on DATE;

UPDATE public.tasks SET status = 'done' WHERE completed;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_completion_matches_status CHECK (completed = (status = 'done')),
  ADD CONSTRAINT tasks_date_order CHECK (starts_on <= due_on);
