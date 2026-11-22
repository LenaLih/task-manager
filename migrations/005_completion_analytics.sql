ALTER TABLE public.task_history ADD COLUMN resulting_status TEXT;
CREATE INDEX task_history_activity ON public.task_history(user_id, occurred_at);

CREATE OR REPLACE FUNCTION public.record_task_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_history(user_id, task_id, action, resulting_status)
      VALUES (NEW.user_id, NEW.id, 'created', NEW.status);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.task_history(user_id, task_id, action)
      VALUES (OLD.user_id, OLD.id, 'deleted');
  ELSIF OLD IS DISTINCT FROM NEW THEN
    INSERT INTO public.task_history(user_id, task_id, action, fields, resulting_status)
      SELECT NEW.user_id, NEW.id, 'updated', ARRAY(
        SELECT field FROM jsonb_each(to_jsonb(NEW)) AS entry(field, value)
          WHERE field <> 'completed' AND value IS DISTINCT FROM to_jsonb(OLD)->field ORDER BY field
      ), CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN NEW.status END;
  END IF;
  RETURN NULL;
END $$;
