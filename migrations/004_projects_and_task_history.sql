CREATE TABLE public.projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'green',
  icon TEXT NOT NULL DEFAULT 'folder',
  archived BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, id)
);

ALTER TABLE public.tasks
  ADD COLUMN project_id TEXT,
  ADD COLUMN category TEXT NOT NULL DEFAULT '',
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN subtasks JSONB NOT NULL DEFAULT '[]',
  ADD CONSTRAINT tasks_project_owner FOREIGN KEY (user_id, project_id)
    REFERENCES public.projects(user_id, id);

CREATE INDEX tasks_project ON public.tasks(user_id, project_id);

CREATE TABLE public.task_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id),
  task_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  fields TEXT[] NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX task_history_owner ON public.task_history(user_id, task_id, id DESC);

CREATE FUNCTION public.guard_task_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.projects WHERE id = NEW.project_id AND user_id = NEW.user_id AND NOT archived FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project unavailable' USING ERRCODE = '23514', CONSTRAINT = 'tasks_active_project';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_task_project BEFORE INSERT OR UPDATE OF project_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_project();

CREATE FUNCTION public.record_task_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_history(user_id, task_id, action) VALUES (NEW.user_id, NEW.id, 'created');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.task_history(user_id, task_id, action) VALUES (OLD.user_id, OLD.id, 'deleted');
  ELSIF OLD IS DISTINCT FROM NEW THEN
    INSERT INTO public.task_history(user_id, task_id, action, fields)
      SELECT NEW.user_id, NEW.id, 'updated', ARRAY(
        SELECT field FROM jsonb_each(to_jsonb(NEW)) AS entry(field, value)
          WHERE field <> 'completed' AND value IS DISTINCT FROM to_jsonb(OLD)->field ORDER BY field
      );
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER record_task_history AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.record_task_history();
