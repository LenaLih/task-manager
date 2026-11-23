import { reminderOptions } from '../types/task'

export function TaskReminderSelect({ disabled, defaultValue, value, onChange }: {
  disabled: boolean
  defaultValue?: number
  value?: number | ''
  onChange?: (value: typeof reminderOptions[number][0] | null) => void
}) {
  return <label>Напоминание<select name="reminderMinutes" disabled={disabled} defaultValue={defaultValue}
    value={value} onChange={onChange ? event => {
      const selected = event.target.value
      onChange(reminderOptions.find(([minutes]) => String(minutes) === selected)?.[0] ?? null)
    } : undefined}>
    <option value="">Без напоминания</option>
    {reminderOptions.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
  </select></label>
}
