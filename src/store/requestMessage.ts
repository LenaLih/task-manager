export function requestMessage(error: unknown, fallback = 'Не удалось выполнить действие. Повторите попытку.') {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') return data.message
  }
  return fallback
}
