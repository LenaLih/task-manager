import { useEffect, useRef, useState } from 'react'

type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean }
type Recognition = {
  lang: string
  continuous?: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionConstructor = new () => Recognition
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor
  webkitSpeechRecognition?: RecognitionConstructor
}
type SpeechState = 'idle' | 'starting' | 'recording' | 'restarting' | 'processing'
type Dictation = {
  recognition?: Recognition
  timer?: number
  stopping: boolean
  confirmed: string
  preview: string
  emptyEnds: number
}

const speechErrors: Record<string, string> = {
  'not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера или введите команду.',
  'service-not-allowed': 'Браузер не разрешил распознавание речи. Введите команду текстом.',
  'audio-capture': 'Микрофон недоступен. Проверьте подключение или введите команду.',
  'no-speech': 'Речь не распознана. Попробуйте ещё раз или введите команду.',
  network: 'Сервис распознавания недоступен. Введите команду текстом.',
}

const join = (left: string, right: string) => [left, right].filter(Boolean).join(' ')

function appendAfterRestart(previous: string, next: string) {
  if (!previous || !next) return join(previous, next)
  const normalize = (word: string) => word.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]/gu, '')
  const tail = previous.split(/\s+/).map(normalize)
  const words = next.split(/\s+/)
  const head = words.map(normalize)
  // Match only the boundary between recognition attempts.
  for (let size = Math.min(tail.length, head.length); size >= 2; size--) {
    if (head.slice(0, size).every((word, index) => word && word === tail[tail.length - size + index])) {
      return join(previous, words.slice(size).join(' '))
    }
  }
  return join(previous, next)
}

export function useVoiceDictation(onTranscript: (value: string) => void) {
  const current = useRef<Dictation | null>(null)
  const [speech, setSpeech] = useState<SpeechState>('idle')
  const [speechError, setSpeechError] = useState('')

  useEffect(() => () => {
    const dictation = current.current
    current.current = null
    window.clearTimeout(dictation?.timer)
    dictation?.recognition?.abort()
  }, [])

  function finish(dictation: Dictation, message = '', abort = false) {
    current.current = null
    window.clearTimeout(dictation.timer)
    if (abort) dictation.recognition?.abort()
    onTranscript(dictation.preview)
    setSpeechError(message)
    setSpeech('idle')
  }

  function begin(dictation: Dictation, SpeechRecognition: RecognitionConstructor, resumed: boolean) {
    const previous = dictation.confirmed
    try {
      const recognition = new SpeechRecognition()
      dictation.recognition = recognition
      const isCurrent = () => current.current === dictation && dictation.recognition === recognition
      recognition.lang = 'ru-RU'
      recognition.interimResults = true
      if ('continuous' in recognition) recognition.continuous = true
      recognition.onstart = () => {
        if (!isCurrent() || dictation.stopping) return
        window.clearTimeout(dictation.timer)
        setSpeech('recording')
      }
      recognition.onresult = ({ results }) => {
        if (!isCurrent()) return
        const final: string[] = []
        const interim: string[] = []
        for (const result of Array.from(results)) {
          (result.isFinal ? final : interim).push(result[0]?.transcript.trim() ?? '')
        }
        const append = resumed ? appendAfterRestart : join
        const confirmed = final.filter(Boolean).join(' ')
        dictation.confirmed = append(previous, confirmed)
        dictation.preview = append(previous, join(confirmed, interim.filter(Boolean).join(' ')))
        onTranscript(dictation.preview)
      }
      recognition.onerror = ({ error }) => {
        if (isCurrent()) finish(dictation, speechErrors[error] ?? 'Не удалось распознать речь. Введите команду текстом.')
      }
      recognition.onend = () => {
        if (!isCurrent()) return
        if (dictation.stopping) {
          finish(dictation)
          return
        }
        window.clearTimeout(dictation.timer)
        dictation.recognition = undefined
        dictation.emptyEnds = dictation.confirmed === previous ? dictation.emptyEnds + 1 : 0
        if (dictation.emptyEnds >= 2) {
          finish(dictation, 'Распознавание остановилось. Можно продолжить запись или исправить текст.')
          return
        }
        dictation.preview = dictation.confirmed
        onTranscript(dictation.preview)
        setSpeech('restarting')
        dictation.timer = window.setTimeout(() => {
          if (current.current === dictation) begin(dictation, SpeechRecognition, true)
        }, 300)
      }
      dictation.timer = window.setTimeout(() => {
        if (isCurrent()) finish(dictation, 'Микрофон долго не отвечает. Проверьте разрешение или введите команду.', true)
      }, 15_000)
      recognition.start()
    } catch {
      finish(dictation, 'Не удалось запустить микрофон. Введите команду текстом.', true)
    }
  }

  function start(text: string) {
    if (current.current) return
    const browser = window as SpeechWindow
    const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSpeechError('В этом браузере нет распознавания речи. Введите команду текстом.')
      return
    }
    setSpeechError('')
    setSpeech('starting')
    const dictation: Dictation = { stopping: false, confirmed: text.trim(), preview: text.trim(), emptyEnds: 0 }
    current.current = dictation
    begin(dictation, SpeechRecognition, false)
  }

  function stop() {
    const dictation = current.current
    if (!dictation || dictation.stopping) return
    dictation.stopping = true
    const recognition = dictation.recognition
    if (!recognition) {
      finish(dictation)
      return
    }
    setSpeech('processing')
    window.clearTimeout(dictation.timer)
    dictation.timer = window.setTimeout(() => finish(dictation, '', true), 3_000)
    try {
      recognition.stop()
    } catch {
      finish(dictation, '', true)
    }
  }

  return { speech, speechError, start, stop, isActive: () => current.current !== null }
}
