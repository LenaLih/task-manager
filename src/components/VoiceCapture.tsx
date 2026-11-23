import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { flushSync } from 'react-dom'
import { taskApi, useAddTaskMutation } from '../store/api'
import { requestMessage } from '../store/requestMessage'
import { currencies } from '../types/finance'
import { localVoiceCommandHandler, validVoiceDay, voiceExpenseAmount } from '../types/voiceCommand'
import type { VoiceAction, VoiceCommandHandler } from '../types/voiceCommand'

import { useVoiceDictation } from './useVoiceDictation'
import { TaskReminderSelect } from './TaskReminderSelect'

type Card = { id: string; action: VoiceAction }

export function VoiceCapture({ handler = localVoiceCommandHandler }: { handler?: VoiceCommandHandler }) {
  const controls = useRef<{ start: () => void }>(null)
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  return <>
    <button type="button" className="voice-trigger" aria-haspopup="dialog" onClick={() => {
      setNotice('')
      flushSync(() => setOpen(true))
      controls.current?.start()
    }}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="13" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6" />
      </svg>
      Голосовой ввод
    </button>
    {notice && <p role="status">{notice}</p>}
    {open && <VoiceDialog controls={controls} handler={handler} close={count => {
      if (count) setNotice(`Сохранено действий: ${count}.`)
      setOpen(false)
    }} />}
  </>
}

function VoiceDialog({ close, controls, handler }: {
  close: (saved: number) => void
  controls: Ref<{ start: () => void }>
  handler: VoiceCommandHandler
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const waiting = useRef(false)
  const saved = useRef(0)
  const [text, setText] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [addTask] = useAddTaskMutation()
  const [writeFinance] = taskApi.useWriteFinanceMutation()
  const finance = taskApi.useFinanceQuery(undefined, {
    skip: !cards.some(card => card.action.kind === 'expense'),
    refetchOnMountOrArgChange: true,
  })
  const accounts = finance.currentData?.accounts.filter(account => !account.archived) ?? []

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  const dictation = useVoiceDictation(value => {
    setText(value)
    setCards([])
  })
  const { speech, speechError, stop } = dictation

  function start() {
    if (dictation.isActive() || waiting.current || saved.current) return
    setError('')
    dictation.start(text)
  }

  useImperativeHandle(controls, () => ({ start }))
  async function parse() {
    if (waiting.current || dictation.isActive() || saved.current) return
    if (text.length > 1000) {
      setError('Сократите команду до 1000 символов.')
      return
    }
    waiting.current = true
    setPending(true)
    setError('')
    setCards([])
    try {
      const result = await handler.parse(text, new Date())
      setCards(result.actions.map(action => ({
        id: crypto.randomUUID(),
        action: action.kind === 'task'
          ? { ...action, title: action.title.slice(0, 1).toLocaleUpperCase('ru-RU') + action.title.slice(1) }
          : action,
      })))
      setError(result.error ?? '')
    } catch {
      setError('Не удалось разобрать команду. Проверьте текст и попробуйте снова.')
    } finally {
      waiting.current = false
      setPending(false)
    }
  }

  function update(card: Card, action: VoiceAction) {
    setCards(previous => previous.map(item => item.id === card.id ? { ...item, action } : item))
  }

  function problem(action: VoiceAction) {
    if ((action.day && !validVoiceDay(action.day)) || (action.clarifyDay && !action.day)) return 'Уточните дату.'
    if (action.kind === 'task') {
      if (action.recurring) return 'Повторяющиеся задачи пока недоступны.'
      if (!action.title.trim() || action.title.trim().length > 300) return 'Укажите название задачи до 300 символов.'
      if (action.clarifyTime || (action.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(action.time))) return 'Уточните время.'
      if (action.time && !action.day) return 'Укажите дату для выбранного времени.'
    } else {
      if (!action.day) return 'Укажите дату расхода.'
      if (!voiceExpenseAmount(action.amount)) return 'Укажите положительную сумму.'
      if (!action.currency) return 'Укажите валюту.'
      if (!action.category.trim() || action.category.trim().length > 80) return 'Укажите категорию расхода до 80 символов.'
      if (!accounts.some(account => account.id === action.accountId && account.currency === action.currency)) {
        return 'Выберите действующий счёт в указанной валюте.'
      }
    }
    return ''
  }

  async function save() {
    if (waiting.current || dictation.isActive() || !cards.length || cards.some(card => problem(card.action))) return
    waiting.current = true
    setPending(true)
    setError('')
    try {
      for (const { action, id } of cards) {
        if (action.kind === 'task') {
          await addTask({
            title: action.title.trim(), dueOn: action.day || null,
            ...(action.time ? {
              dueTime: action.time,
              dueZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              reminderMinutes: action.reminderMinutes,
            } : {}),
          }).unwrap()
        } else {
          await writeFinance({ resource: 'entries', id, body: {
            kind: 'expense', accountId: action.accountId, amount: voiceExpenseAmount(action.amount),
            day: action.day, category: action.category.trim(), note: action.title.trim(),
          } }).unwrap()
        }
        saved.current++
        setSavedCount(saved.current)
        setCards(previous => previous.filter(card => card.id !== id))
      }
      close(saved.current)
    } catch (failure) {
      setError(`${requestMessage(failure)} Сохранено действий: ${saved.current}. Перед повтором проверьте список задач.`)
    } finally {
      waiting.current = false
      setPending(false)
    }
  }

  const active = speech !== 'idle'
  return <dialog ref={dialog} className="work-dialog voice-dialog" aria-labelledby="voice-title"
    onCancel={event => { event.preventDefault(); if (!waiting.current) close(saved.current) }}>
    <h2 id="voice-title">Голосовая команда</h2>
    <div className="voice-body">
      <div className="voice-buttons">
        {active
          ? <button type="button" onClick={stop} disabled={speech === 'processing'}>Завершить запись</button>
          : <button type="button" onClick={start} disabled={pending || savedCount > 0}>Начать запись</button>}
        <p className="voice-status" role="status" data-recording={speech === 'recording' || speech === 'restarting'}>
          {{ idle: '', starting: 'Подключаем микрофон…', recording: 'Идёт запись…', restarting: 'Продолжаем запись…', processing: 'Распознаём речь…' }[speech]}
        </p>
      </div>
      {speechError && <p className="work-error" role="alert">{speechError}</p>}
      <fieldset disabled={active || pending}>
        <label>Текст команды<textarea value={text} maxLength={1000} rows={3} readOnly={savedCount > 0}
          placeholder="Например, завтра в десять утра позвонить врачу"
          onChange={event => { setText(event.target.value); setCards([]); setError('') }} /></label>
        <button type="button" onClick={() => void parse()} disabled={!text.trim() || savedCount > 0}>Разобрать команду</button>
        {cards.map(card => {
          const { action } = card
          const hint = problem(action)
          return <fieldset className="voice-card" key={card.id}>
            <legend>{action.kind === 'task' ? 'Задача' : 'Расход'}</legend>
            <label>{action.kind === 'task' ? 'Название задачи' : 'Описание расхода'}
              <input value={action.title} maxLength={action.kind === 'task' ? 300 : 500}
                onChange={event => update(card, { ...action, title: event.target.value })} />
            </label>
            <div className="voice-fields">
              <label>Дата<input type="date" value={action.day} onChange={event =>
                update(card, { ...action, day: event.target.value, clarifyDay: false })} /></label>
              {action.kind === 'task' ? <label>Время<input type="time" value={action.time} onChange={event =>
                update(card, { ...action, time: event.target.value, clarifyTime: false })} /></label> : <>
                <label>Сумма<input value={action.amount} inputMode="decimal" maxLength={16}
                  onChange={event => update(card, { ...action, amount: event.target.value })} /></label>
                <label>Валюта<select value={action.currency} onChange={event => update(card, {
                  ...action, currency: event.target.value as typeof action.currency, accountId: '',
                })}><option value="">Выберите валюту</option>{currencies.map(currency =>
                  <option key={currency}>{currency}</option>)}</select></label>
              </>}
            </div>
            {action.kind === 'task' ? <>
              <TaskReminderSelect disabled={!action.day || !action.time}
                value={action.reminderMinutes ?? ''}
                onChange={reminderMinutes => update(card, { ...action, reminderMinutes })} />
              {action.clarifyTime && <button type="button" onClick={() =>
                update(card, { ...action, time: '', clarifyTime: false, reminderMinutes: null })}>Без времени</button>}
              {action.recurring && <label className="voice-once"><input type="checkbox" onChange={() =>
                update(card, { ...action, recurring: false, day: '', clarifyDay: true })} /> Создать разовую задачу</label>}
            </> : <>
              <label>Категория<input value={action.category} maxLength={80}
                onChange={event => update(card, { ...action, category: event.target.value })} /></label>
              <label>Счёт<select value={action.accountId} onChange={event =>
                update(card, { ...action, accountId: event.target.value })}>
                <option value="">Выберите счёт</option>
                {accounts.filter(account => account.currency === action.currency).map(account =>
                  <option key={account.id} value={account.id}>{account.name}</option>)}
              </select></label>
              {finance.isFetching && <p role="status">Загружаем счета…</p>}
              {finance.isError && <button type="button" onClick={() => void finance.refetch()}>Повторить загрузку счетов</button>}
              {finance.isSuccess && action.currency && !accounts.some(account => account.currency === action.currency) &&
                <p>В разделе «Финансы» нужен действующий счёт в валюте {action.currency}.</p>}
            </>}
            {hint && <p className="work-error">{hint}</p>}
            <button type="button" onClick={() => setCards(previous => previous.filter(item => item.id !== card.id))}>
              Исключить действие
            </button>
          </fieldset>
        })}
      </fieldset>
      {error && <p className="work-error" role="alert">{error}</p>}
    </div>
    <div className="voice-buttons">
      <button type="button" onClick={() => close(saved.current)} disabled={pending}>Отмена</button>
      {cards.length > 0 && <button type="button" className="add-button" onClick={() => void save()}
        disabled={active || pending || cards.some(card => problem(card.action))}>
        {pending ? 'Сохраняем…' : 'Подтвердить и сохранить'}
      </button>}
    </div>
  </dialog>
}
