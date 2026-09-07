export function log(...a) {
  console.log(new Date().toISOString(), ...a)
}

export function fmtDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'live'
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor((totalSeconds / 60) % 60)
  const h = Math.floor(totalSeconds / 3600)
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function truncate(str, n) {
  str = String(str ?? '')
  return str.length > n ? `${str.slice(0, n - 1)}…` : str
}

export function randomId(n = 12) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < n; i++) out += c[Math.floor(Math.random() * c.length)]
  return out
}

export function isHttpUrl(s) {
  try {
    const u = new URL(String(s))
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
