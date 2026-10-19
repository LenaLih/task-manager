import type { TaskFilter } from '../types/task'

type TaskFiltersProps = {
  value: TaskFilter
  onChange: (filter: TaskFilter) => void
}

type FilterOption = {
  value: TaskFilter
  label: string
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'completed', label: 'Выполненные' },
]

export function TaskFilters({ value, onChange }: TaskFiltersProps) {
  return (
    <div className="filters" role="group" aria-label="Фильтр задач">
      {FILTER_OPTIONS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          aria-pressed={value === filter.value}
          className={value === filter.value ? 'selected' : ''}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}
