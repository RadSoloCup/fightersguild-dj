import { config } from './config.js'

const UA = config.userAgent

async function req(method, path, body) {
  const url = `${config.bot.apiBase}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bot ${config.bot.token}`,
      'user-agent': UA,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`${method} ${path} → ${res.status} ${t.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}

// Discord-wire-compatible gateway bootstrap. Returns { url, shards, ... }.
export function getBotGateway() {
  return req('GET', '/gateway/bot')
}

export function sendMessage(channelId, payload) {
  return req('POST', `/channels/${channelId}/messages`, payload)
}

export function getChannel(channelId) {
  return req('GET', `/channels/${channelId}`)
}

export function getGuildChannels(guildId) {
  return req('GET', `/guilds/${guildId}/channels`)
}

export async function startTyping(channelId) {
  try { await req('POST', `/channels/${channelId}/typing`) } catch {}
}
