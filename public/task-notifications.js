/* global self */
self.addEventListener('notificationclick', event => {
  const taskId = event.notification.data?.taskId
  if (typeof taskId !== 'string' || !taskId || event.notification.tag?.split(':')[0] !== taskId) return
  event.notification.close()
  const url = new URL('/tasks/' + encodeURIComponent(taskId), self.location.origin)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = windows.find(window => window.url === url.href)
      ?? windows.find(window => new URL(window.url).origin === url.origin)
    if (client) {
      const target = client.url === url.href ? client : await client.navigate(url.href).catch(() => null)
      if (target) {
        await target.focus().catch(() => {})
        return
      }
    }
    await self.clients.openWindow(url.href)
  })())
})
