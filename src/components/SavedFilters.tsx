import { useState } from 'react'
import { useDeleteFilterMutation, useSavedFiltersQuery, useSaveFilterMutation } from '../store/api'
import type { SavedFilter } from '../types/workspace'
import { requestMessage } from '../store/requestMessage'

export function SavedFilters({ current, apply }: { current: SavedFilter['filters']; apply: (filters: SavedFilter['filters']) => void }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const [feedback, setFeedback] = useState('')
  const saved = useSavedFiltersQuery(undefined, { skip: !open })
  const [save, saving] = useSaveFilterMutation()
  const [remove, removing] = useDeleteFilterMutation()
  const busy = saving.isLoading || removing.isLoading
  return <details className="work-saved-filters" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Сохранённые фильтры</summary>
    {open && <>
      {saved.isLoading && <p role="status">Загружаем фильтры…</p>}
      {saved.isError && <p role="alert">Не удалось загрузить фильтры.{' '}
        <button type="button" onClick={() => void saved.refetch()}>Повторить</button></p>}
      <div className="work-tools">
        <select aria-label="Сохранённый фильтр" value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">Выберите фильтр</option>
          {saved.data?.map(({ name }) => <option key={name}>{name}</option>)}
        </select>
        <button type="button" disabled={!selected || busy} onClick={() => {
          const preset = saved.data?.find(({ name }) => name === selected)
          if (preset) { apply(preset.filters); setFeedback('Фильтр применён.') }
        }}>Применить</button>
        <button type="button" disabled={!selected || busy} onClick={async () => {
          try { await remove(selected).unwrap(); setSelected(''); setFeedback('Фильтр удалён.') }
          catch (error) { setFeedback(requestMessage(error)) }
        }}>Удалить фильтр</button>
      </div>
      <form className="work-tools" onSubmit={async event => {
        event.preventDefault()
        const form = event.currentTarget
        const name = String(new FormData(form).get('name')).trim()
        if (!name) { setFeedback('Введите название фильтра.'); return }
        try {
          await save({ name, filters: current }).unwrap()
          setSelected(name)
          form.reset()
          setFeedback('Фильтр сохранён.')
        } catch (error) { setFeedback(requestMessage(error)) }
      }}>
        <input name="name" aria-label="Название фильтра" placeholder="Название фильтра" maxLength={60} required />
        <button type="submit" disabled={busy}>Сохранить текущий фильтр</button>
      </form>
      {feedback && <p role={saving.isError || removing.isError ? 'alert' : 'status'}>{feedback}</p>}
    </>}
  </details>
}
