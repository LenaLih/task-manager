import { expect, it } from 'vitest'
import { tasksCsv } from './task-export'

it('preserves UTF-8, quotes, commas, line breaks and serializes arrays', () => {
  const result = tasksCsv([{ title: 'Текст, "да"', description: 'line 1\nline 2', tags: ['один', 'два'] }])
  expect(result.charCodeAt(0)).toBe(0xfeff)
  expect(result).toContain('"Текст, ""да"""')
  expect(result).toContain('"line 1\nline 2"')
  expect(result).toContain('"[""один"",""два""]"')
  expect(result.endsWith('\r\n')).toBe(true)
})

it('escapes spreadsheet formula prefixes in text cells', () => {
  expect(tasksCsv([{ title: '=SUM(A1)', description: ' +1' }])).toContain('"\'=SUM(A1)","","\' +1"')
})
