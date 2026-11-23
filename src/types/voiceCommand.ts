import { minorUnits } from './finance'
import type { Currency } from './finance'
import type { ReminderMinutes } from './task'
import { addDays, localDay } from './planning'

type TaskAction = {
  kind: 'task'; title: string; day: string; time: string
  clarifyDay: boolean; clarifyTime: boolean; recurring: boolean; reminderMinutes: ReminderMinutes | null
}
type ExpenseAction = {
  kind: 'expense'; title: string; day: string; clarifyDay: boolean
  amount: string; currency: Currency | ''; category: string; accountId: string
}
export type VoiceAction = TaskAction | ExpenseAction
type ParseResult = { actions: VoiceAction[]; error?: string }
export interface VoiceCommandHandler {
  parse(text: string, now: Date): ParseResult | Promise<ParseResult>
}

const weekdays = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу']
const relativeDays = ['сегодня', 'завтра', 'послезавтра']
const dayPattern = new RegExp(
  `(?<![\\p{L}\\d])(?:${relativeDays.join('|')}|в(?:о)?\\s+(?:следующ(?:ий|ую|ее)\\s+)?(?:${weekdays.join('|')})|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?(?!\\s*(?:сом|рубл|доллар|kgs|rub|usd)))(?![\\p{L}\\d])`, 'giu',
)
const months = 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'.split(' ')
const ordinalDays = [
  ['первое', 'первого'], ['второе', 'второго'], ['третье', 'третьего'], ['четвёртое', 'четвёртого'],
  ['пятое', 'пятого'], ['шестое', 'шестого'], ['седьмое', 'седьмого'], ['восьмое', 'восьмого'],
  ['девятое', 'девятого'], ['десятое', 'десятого'], ['одиннадцатое', 'одиннадцатого'],
  ['двенадцатое', 'двенадцатого'], ['тринадцатое', 'тринадцатого'], ['четырнадцатое', 'четырнадцатого'],
  ['пятнадцатое', 'пятнадцатого'], ['шестнадцатое', 'шестнадцатого'],
  ['семнадцатое', 'семнадцатого'], ['восемнадцатое', 'восемнадцатого'],
  ['девятнадцатое', 'девятнадцатого'], ['двадцатое', 'двадцатого'],
  ...['перв', 'втор', 'треть', 'четвёрт', 'пят', 'шест', 'седьм', 'восьм', 'девят']
    .map((stem, index) => index === 2 ? ['двадцать третье', 'двадцать третьего'] : [`двадцать ${stem}ое`, `двадцать ${stem}ого`]),
  ['тридцатое', 'тридцатого'], ['тридцать первое', 'тридцать первого'],
]
const ordinalValues = new Map(ordinalDays.flatMap((forms, index) => forms.map(form => [form, index + 1] as const)))
const ordinalPattern = [...ordinalValues.keys()].join('|').replaceAll('ё', '[её]').replaceAll(' ', '\\s+')
const namedDate = `(?<namedDay>\\d{1,2}|(?:${ordinalPattern}))\\s+(?<month>${months.join('|')})(?:\\s+(?<namedYear>\\d{4,}(?![:\\d])|\\d+(?=\\s+года))(?:\\s+года)?)?`
const numericDate = `(?<numericDay>\\d{1,2})(?<separator>[./])(?<numericMonth>\\d{1,2})(?<yearSeparator>[./])(?<numericYear>\\d+)`
const absoluteDate = `(?:(?:в|на|до|к)\\s+)?(?:${namedDate}|${numericDate})`
const taskDayPattern = new RegExp(
  `(?<![\\p{L}\\d./-])${absoluteDate}(?![\\p{L}\\d]|[./-]\\d)|${dayPattern.source}`, 'giu',
)
const ambiguousTaskDay = new RegExp(
  `(?<![\\p{L}\\d])(?:с\\s+)?(?:\\d{1,2}|(?:${ordinalPattern}))(?:\\s+(?:или|и|по|до)\\s+|\\s*[-–—]\\s*)(?:${namedDate})(?![\\p{L}\\d])`, 'iu',
)
const hours = 'ноль один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать'.split(' ')
const listCounts: Record<string, number> = { две: 2, два: 2, три: 3, четыре: 4, пять: 5 }
const spokenUnits = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать',
  'семнадцать', 'восемнадцать', 'девятнадцать']
const spokenTens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
const spokenHundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']
const timePattern = new RegExp(
  `(?<![\\p{L}\\d])(?:в\\s+(?:\\d{1,2}(?::\\d{2})?|${hours.join('|')})(?:\\s+(?:час(?:а|ов)?))?(?:\\s+(?:утра|дня|вечера|ночи))?|\\d{1,2}:\\d{2})(?![\\p{L}\\d])`, 'giu',
)
const currencyPattern = /(?<!\p{L})(сом(?:а|ов)?|руб(?:ль|ля|лей|\.)?|доллар(?:а|ов)?|KGS|RUB|USD|[₽$])(?!\p{L})/giu
const taskPrefix = /^(?:(?:создай|добавь|запиши)\s+(?:(?:\d+|одну|две|два|три|четыре|пять)\s+)?задач[ауи]?|напомни(?:\s+мне)?)(?!\p{L})\s*[: ,-]*/iu
const recurrence = /(?<!\p{L})(?:кажд\p{L}*|ежедневно|еженедельно|ежемесячно|ежегодно|по\s+(?:понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям))(?!\p{L})/iu
const recurringPrefix = new RegExp(
  `^кажд(?:ый|ую|ое)\\s+(?:${weekdays.join('|')}|день|неделю|месяц|год)\\s+(?:напоминать\\s+)?`, 'iu',
)

function spokenAmount(text: string): string {
  function group(words: string) {
    const parts = words.trim().split(/\s+/)
    const hundreds = spokenHundreds.indexOf(parts[0])
    if (hundreds > 0) parts.shift()
    const tens = spokenTens.indexOf(parts[0])
    if (tens > 0) parts.shift()
    let units = spokenUnits.indexOf(parts[0])
    if (/^(одна|две)$/.test(parts[0] ?? '')) units = parts[0] === 'одна' ? 1 : 2
    if (units > 0 && (tens <= 0 || units < 10)) parts.shift()
    if (parts.length) return NaN
    return Math.max(0, hundreds) * 100 + Math.max(0, tens) * 10 + Math.max(0, units)
  }
  const thousands = /^(?:(.+)\s+)?тысяч(?:а|и)?(?:\s+(.+))?$/u.exec(text)
  const amount = thousands ? (thousands[1] ? group(thousands[1]) : 1) * 1000 +
    (thousands[2] ? group(thousands[2]) : 0) : group(text)
  return amount > 0 ? String(amount) : ''
}

function taskAbsoluteDay(groups: Record<string, string | undefined>, today: string) {
  const { namedDay, month, namedYear, numericDay, numericMonth, numericYear, separator, yearSeparator } = groups
  if (numericDay && separator !== yearSeparator) return ''
  const ordinal = namedDay?.toLowerCase().replace(/четверт/g, 'четвёрт').replace(/\s+/g, ' ') ?? ''
  const day = numericDay ?? ordinalValues.get(ordinal) ?? namedDay
  const monthNumber = month ? months.indexOf(month.toLowerCase()) + 1 : numericMonth
  const monthDay = `${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const year = namedYear ?? numericYear
  if (year !== undefined) {
    const date = `${year}-${monthDay}`
    return validVoiceDay(date) ? date : ''
  }
  // A leap year lets us reject impossible month/day pairs without rejecting February 29.
  if (!validVoiceDay(`2000-${monthDay}`)) return ''
  for (let year = Number(today.slice(0, 4)); year <= 9999; year++) {
    const date = `${String(year).padStart(4, '0')}-${monthDay}`
    if (date > today && validVoiceDay(date)) return date
  }
  return ''
}

function schedule(text: string, today: string, task = false) {
  const datePattern = task ? taskDayPattern : dayPattern
  const hasAmbiguousTaskDay = task && ambiguousTaskDay.test(text)
  const dates = [...text.matchAll(datePattern)]
  const withoutDates = text.replace(datePattern, '')
  const times = [...(task ? withoutDates : text).matchAll(timePattern)]
  let day = ''
  let time = ''
  if (dates.length === 1) {
    const phrase = dates[0][0].toLowerCase()
    const offset = relativeDays.indexOf(phrase)
    const weekday = weekdays.indexOf(phrase.split(/\s+/).at(-1) ?? '')
    if (offset >= 0) day = addDays(today, offset)
    else if (weekday >= 0 && !phrase.includes('следующ')) {
      const current = new Date(today + 'T00:00:00Z').getUTCDay()
      if (weekday !== current) day = addDays(today, (weekday - current + 7) % 7)
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(phrase) && validVoiceDay(phrase)) day = phrase
    else if (dates[0].groups?.namedDay || dates[0].groups?.numericDay) day = taskAbsoluteDay(dates[0].groups, today)
  }
  if (times.length === 1) {
    const phrase = times[0][0].toLowerCase().replace(/^в\s+/, '')
    const [clock] = phrase.split(/\s+/)
    const [rawHour, minute = 0] = clock.split(':').map(Number)
    let hour = Number.isNaN(rawHour) ? hours.indexOf(clock) : rawHour
    const period = phrase.match(/(?:утра|дня|вечера|ночи)$/)?.[0]
    if (period === 'дня' || period === 'вечера') {
      if (hour > 0 && hour < 12) hour += 12
    } else if ((period === 'утра' || period === 'ночи') && hour === 12) hour = 0
    if (hour >= 0 && hour < 24 && minute < 60 &&
      (period ? rawHour <= 12 || Number.isNaN(rawHour) : clock.includes(':') || hour > 12 || hour === 0)) {
      time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    }
  }
  const unclearDay = /(?<!\p{L})(?:на\s+(?:следующ\p{L}+\s+)?неделе|через\s+\d+\s+дн\p{L}*|в\s+выходные|\d{1,2}\s+(?:числа|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))(?!\p{L})/iu
  const unclearTime = /(?<!\p{L})(?:утром|днём|днем|вечером|ночью|в\s+полдень|в\s+полночь|около\s+\d+|в\s+половине)(?!\p{L})/iu
  const clarifyDay = hasAmbiguousTaskDay || (!day && dates.length > 0) || unclearDay.test(task ? withoutDates : text)
  const clarifyTime = (!time && times.length > 0) || unclearTime.test(text)
  return {
    day: clarifyDay ? '' : day, time: clarifyTime ? '' : time, clarifyDay, clarifyTime,
    title: (hasAmbiguousTaskDay ? text.replace(ambiguousTaskDay, '').replace(datePattern, '') : withoutDates)
      .replace(timePattern, '').replace(unclearDay, '').replace(unclearTime, '')
      .replace(/\s+/g, ' ').replace(/^[\s,.:!?]+|[\s,.:!?]+$/g, ''),
  }
}

export function validVoiceDay(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(value + 'T00:00:00Z')
  return Number.isFinite(+day) && day.toISOString().slice(0, 10) === value
}

function currencyOf(word: string): Currency {
  if (/^(kgs|сом)/i.test(word.toLowerCase())) return 'KGS'
  if (/^(rub|руб|₽)/i.test(word.toLowerCase())) return 'RUB'
  return 'USD'
}

function expense(text: string, today: string): ParseResult {
  const fields = schedule(text, today)
  const matches = [...fields.title.matchAll(currencyPattern)]
  const match = matches.length === 1 ? matches[0] : undefined
  const category = /(?:^|\s)на\s+(.+)$/iu.exec(fields.title)?.[1]?.trim() ?? ''
  const amountText = match
    ? fields.title.slice(0, match.index).trimEnd()
    : fields.title.replace(/(?:^|\s)на\s+.+$/iu, '').trimEnd()
  const numeric = /^(?:суммой\s+)?(\d+(?:[.,]\d{1,2})?|\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?)$/iu.exec(amountText)?.[1]
  const tail = match ? fields.title.slice(match.index + match[0].length).trim() : ''
  const ambiguous = matches.length > 1 || Boolean(tail && !/^на\s+\S/iu.test(tail))
  const hasMultipleOperations = /[;\n]|(?<!\p{L})(?:и\s+(?:добавь|создай|запиши|расход)|расход\p{L}*)(?!\p{L})/iu.test(text)
  if (hasMultipleOperations || fields.time || fields.clarifyTime) {
    return { actions: [], error: 'Расход можно указать одной командой с датой, суммой, валютой и категорией.' }
  }
  return { actions: [{
    kind: 'expense', title: '', day: fields.clarifyDay ? '' : fields.day || today, clarifyDay: fields.clarifyDay,
    amount: ambiguous ? '' : numeric?.replace(/[ \u00a0\u202f]/g, '') ?? spokenAmount(amountText.toLowerCase()),
    currency: match ? currencyOf(match[0]) : '',
    category: ambiguous || /\sили\s/iu.test(category) ? '' : category, accountId: '',
  }] }
}

export const localVoiceCommandHandler: VoiceCommandHandler = {
  parse(input, now) {
    const text = input.trim()
    const today = localDay(now)
    if (!text || !/[\p{L}\d]/u.test(text)) return { actions: [], error: 'Введите команду.' }
    const expensePrefix = /^(?:(?:добавь|запиши|создай)\s+)?расход(?=\s|:|$)\s*:?\s*/iu
    if (expensePrefix.test(text) && !recurrence.test(text)) return expense(text.replace(expensePrefix, ''), today)
    if (/(?<!\p{L})(?:расход|доход|перевод)(?!\p{L})/iu.test(text)) {
      return { actions: [], error: 'Для записи расхода используйте отдельную команду «Добавь расход …».' }
    }
    if (/^(?:удали|убери|отмени|перенеси|измени|покажи|заверши)(?!\p{L})/iu.test(text)) {
      return { actions: [], error: 'Голосовой ввод поддерживает создание задач и запись расходов.' }
    }
    const body = text.replace(taskPrefix, '')
    const list = /^(?:создай|добавь|запиши)\s+(\d+|две|два|три|четыре|пять)\s+задач[аи]?/iu.exec(text)
    const count = list ? listCounts[list[1].toLowerCase()] ?? Number(list[1]) : undefined
    const parts = body.split(list || /задачи\s*:/iu.test(text)
      ? /[;\n]|,(?!\d)|\s+и\s+/u : /[;\n]/u).map(part => part.trim())
    if ((count !== undefined && count !== parts.length) || parts.length > 10 || parts.some(part => !part)) {
      return { actions: [], error: 'Уточните список задач. Перечислите до 10 задач через точку с запятой.' }
    }
    return { actions: parts.map(part => {
      const recurring = recurrence.test(part)
      const fields = schedule(part.replace(taskPrefix, '').replace(recurringPrefix, ''), today, true)
      return { ...fields, kind: 'task', recurring, reminderMinutes: null }
    }) }
  },
}

export function voiceExpenseAmount(value: string) {
  try { return minorUnits(value) } catch { return '' }
}
