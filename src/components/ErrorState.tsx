type ErrorStateProps = {
  message: string
  retryLabel: string
  pending: boolean
  onRetry: () => void
}

export function ErrorState({ message, retryLabel, pending, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state">
      <span className="error-state-icon" aria-hidden="true">!</span>
      <p role={pending ? 'status' : 'alert'}>{message}</p>
      <button type="button" className="add-button" onClick={onRetry} disabled={pending} aria-busy={pending}>
        {pending ? 'Повторяем…' : retryLabel}
      </button>
    </div>
  )
}
