export function formatDashboardPeriod(daysAgo: number, timezone: string, endDay?: string) {
  const day = endDay ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const end = new Date(`${day}T00:00:00Z`)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - daysAgo)

  const formatter = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return `Del ${formatter.format(start)} al ${formatter.format(end)}`
}
