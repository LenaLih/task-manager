const columns = ['id', 'title', 'completed', 'description', 'status', 'priority', 'startsOn',
  'dueOn', 'projectId', 'category', 'tags', 'subtasks', 'dueTime', 'dueZone', 'reminderMinutes'] as const

function cell(value: unknown) {
  let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
  // Prevent spreadsheet formula execution when opening user-entered text.
  if (typeof value === 'string' && /^(?:\s*[=+@-]|[\t\r\n])/u.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}

export function tasksCsv(tasks: ReadonlyArray<Partial<Record<typeof columns[number], unknown>>>) {
  return '\uFEFF' + [columns.join(','), ...tasks.map(task => columns.map(column => cell(task[column])).join(','))].join('\r\n') + '\r\n'
}
