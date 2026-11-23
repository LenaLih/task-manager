import { describe, expect, it } from 'vitest'
import { localVoiceCommandHandler, voiceExpenseAmount } from './voiceCommand'

const parse = (text: string) => localVoiceCommandHandler.parse(text, new Date(2026, 11, 31, 23, 30))

describe('локальный разбор голосовых команд', () => {
  it.each([
    ['30 декабря', '2026-12-30'],
    ['30 декабря 2026 года', '2026-12-30'],
    ['30.12.2026', '2026-12-30'],
    ['30/12/2026', '2026-12-30'],
    ['первого января', '2027-01-01'],
    ['пятое декабря', '2026-12-05'],
    ['двадцать четвертого декабря', '2026-12-24'],
    ['в 30.12.2026', '2026-12-30'],
  ])('разбирает абсолютную дату «%s» вместе со временем', async (phrase, day) => {
    const result = await localVoiceCommandHandler.parse(`${phrase} приготовить торт в 19:00`, new Date(2026, 10, 23))
    expect(result.actions).toMatchObject([{ title: 'приготовить торт', day, time: '19:00', clarifyDay: false, clarifyTime: false }])
  })

  it.each([
    ['31 декабря', new Date(2026, 11, 31), '2027-12-31'],
    ['30 декабря', new Date(2026, 11, 31), '2027-12-30'],
    ['первого января', new Date(2026, 11, 31), '2027-01-01'],
    ['29 февраля', new Date(2026, 10, 23), '2028-02-29'],
    ['29 февраля', new Date(2096, 2, 1), '2104-02-29'],
    ['29 февраля 2024 года', new Date(2026, 10, 23), '2024-02-29'],
    ['29/02/2000', new Date(2026, 10, 23), '2000-02-29'],
  ])('выбирает ближайшую будущую дату для «%s» без года', async (phrase, now, day) => {
    const result = await localVoiceCommandHandler.parse(`к ${phrase} забрать заказ`, now)
    expect(result.actions).toMatchObject([{ title: 'забрать заказ', day, clarifyDay: false }])
  })

  it.each([
    '31 апреля', '30 февраля', '29 февраля 2026 года', '29.02.2100', '31/04/2026', '30.13.2026',
    '30/12/26', '30.12/2026', '30.12', '30 числа', '30 декабря 26 года', '30 декабря 20260 года',
    '30 декабря или 31 декабря', '29 или 30 декабря', 'с 29 по 30 декабря', 'завтра или 30 декабря',
  ])('запрашивает уточнение для даты «%s»', async (phrase) => {
    const result = await localVoiceCommandHandler.parse(`${phrase} забрать заказ`, new Date(2026, 10, 23))
    expect(result.actions).toMatchObject([{ day: '', clarifyDay: true }])
  })

  it('разбирает русские даты и время по локальному календарю на границе года', async () => {
    expect((await parse('Завтра в десять утра позвонить врачу.')).actions).toMatchObject([
      { kind: 'task', title: 'позвонить врачу', day: '2027-01-01', time: '10:00' },
    ])
    expect((await parse('Послезавтра в 16:45 купить лекарства')).actions).toMatchObject([
      { day: '2027-01-02', time: '16:45' },
    ])
    expect((await parse('В пятницу оплатить интернет 1500 сом')).actions).toMatchObject([
      { kind: 'task', title: 'оплатить интернет 1500 сом', day: '2027-01-01' },
    ])
    expect((await parse('Сегодня позвонить врачу')).actions).toMatchObject([{ day: '2026-12-31' }])
  })

  it('создаёт список действий и выявляет пропущенную задачу', async () => {
    expect((await parse('Создай три задачи: купить продукты, забрать посылку и позвонить маме')).actions
      .map(action => action.title)).toEqual(['купить продукты', 'забрать посылку', 'позвонить маме'])
    expect(await parse('Создай три задачи: купить продукты и забрать посылку')).toMatchObject({ actions: [], error: expect.any(String) })
  })

  it('помечает неоднозначные дату и время и обнаруживает повторение', async () => {
    expect((await parse('В следующую пятницу в десять забрать заказ')).actions).toMatchObject([
      { clarifyDay: true, clarifyTime: true, day: '', time: '' },
    ])
    expect((await parse('Каждый понедельник напоминать купить продукты')).actions).toMatchObject([{ recurring: true }])
    expect((await parse('2027-02-30 позвонить врачу')).actions).toMatchObject([{ clarifyDay: true, day: '' }])
    expect((await parse('Завтра или на следующей неделе забрать заказ')).actions).toMatchObject([
      { clarifyDay: true, day: '' },
    ])
    expect((await parse('Создай задачу')).actions).toEqual([])
  })

  it.each([
    ['800 сом', '800', 'KGS'],
    ['восемьсот сомов', '800', 'KGS'],
    ['одна тысяча пятьсот рублей', '1500', 'RUB'],
    ['1 500,25 рублей', '1500,25', 'RUB'],
    ['12.50 долларов', '12.50', 'USD'],
  ])('разбирает расход %s', async (value, amount, currency) => {
    expect((await parse(`Добавь расход ${value} на продукты`)).actions).toMatchObject([
      { kind: 'expense', day: '2026-12-31', amount, currency, category: 'продукты', accountId: '' },
    ])
  })

  it('оставляет спорные и пропущенные параметры расхода для уточнения', async () => {
    expect((await parse('расход 800 или 900 сом')).actions).toMatchObject([{ amount: '', currency: 'KGS', category: '' }])
    expect((await parse('расход 800 сом или 900 на продукты')).actions).toMatchObject([{ amount: '', category: '' }])
    expect((await parse('расход 800 сом на продукты или такси')).actions).toMatchObject([{ amount: '800', category: '' }])
    expect((await parse('расход -800 сом на продукты')).actions).toMatchObject([{ amount: '' }])
    expect((await parse('расход 800 на продукты')).actions).toMatchObject([{ amount: '800', currency: '' }])
    expect((await parse('расход 800 сом на продукты; расход 30 USD на такси')).actions).toEqual([])
    expect(voiceExpenseAmount('1,05')).toBe('105')
    expect(voiceExpenseAmount('-1')).toBe('')
    expect(voiceExpenseAmount('0')).toBe('')
  })
})
