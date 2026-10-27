// Presenters. A value that cannot be shown honestly becomes an em dash rather
// than a misleading zero — every one of these is a pure function.
export const DASH = '—'

export function formatBytes(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return DASH
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB']
  let size = n / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`
}

export function formatDuration(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return DASH
  if (n < 1000) return `${Math.round(n)} ms`
  const seconds = n / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

/** Renders an RFC 3339 stamp in the viewer's locale, or an em dash. */
export function formatTime(value, lang) {
  if (!value) return DASH
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return DASH
  try {
    return new Intl.DateTimeFormat(lang || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch (error) {
    console.error('agentbuddy: cannot format time', error)
    return DASH
  }
}

/** A short stamp for dense lists: time only, or the date when it is older. */
export function formatShortTime(value, lang) {
  if (!value) return DASH
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return DASH
  const sameDay = new Date().toDateString() === date.toDateString()
  try {
    return new Intl.DateTimeFormat(lang || undefined, sameDay
      ? { timeStyle: 'short' }
      : { dateStyle: 'short' }).format(date)
  } catch (error) {
    console.error('agentbuddy: cannot format short time', error)
    return DASH
  }
}

export function formatRows(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) return DASH
  return String(n)
}

/** Percentages are always rendered with an explicit denominator nearby. */
export function formatRatio(part, whole) {
  const a = Number(part)
  const b = Number(whole)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return DASH
  return `${Math.round((a / b) * 100)}%`
}
