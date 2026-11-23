ALTER TABLE public.tasks
  ADD COLUMN due_time TIME(0),
  ADD COLUMN due_zone TEXT,
  ADD COLUMN reminder_minutes INTEGER,
  ADD CONSTRAINT tasks_timed_deadline CHECK (
    (due_time IS NULL AND due_zone IS NULL AND reminder_minutes IS NULL)
    OR (due_time IS NOT NULL AND due_on IS NOT NULL AND due_zone IS NOT NULL
      AND due_time < TIME '24:00' AND EXTRACT(SECOND FROM due_time) = 0
      AND ((due_on + due_time) AT TIME ZONE due_zone) AT TIME ZONE due_zone = due_on + due_time
      AND (reminder_minutes IS NULL OR reminder_minutes IN (0, 15, 60, 1440)))
  );
