import { config } from '../config.js'
import { log, fmtDuration, truncate } from '../lib.js'
import { sendMessage } from '../api.js'
import { VoiceConnection } from './voiceConnection.js'

// One GuildPlayer per guild: owns the voice connection, the queue, and the
// currently playing track.
class GuildPlayer {
  constructor(manager, guildId) {
    this.manager = manager
    this.gw = manager.gw
    this.guildId = guildId
    this.vc = null
    this.queue = []
    this.current = null
    this.startedAt = 0
    this.textChannelId = null
    this.idleTimer = null
    this._connecting = null
  }

  async ensureConnected(voiceChannelId, textChannelId) {
    this.textChannelId = textChannelId || this.textChannelId
    if (this.vc && this.vc.channelId === voiceChannelId && !this.vc._destroyed) return
    if (this.vc && this.vc.channelId !== voiceChannelId) await this._teardownVc()
    if (this._connecting) return this._connecting

    this._connecting = (async () => {
      const vc = new VoiceConnection(this.gw, { guildId: this.guildId, channelId: voiceChannelId })
      vc.on('ended', info => this._onTrackEnd('ended', info))
      vc.on('stopped', () => {})
      vc.on('closed', () => this._onVcClosed())
      await vc.connect()
      this.vc = vc
    })()
    try {
      await this._connecting
    } finally {
      this._connecting = null
    }
  }

  enqueue(track, requestedBy) {
    if (this.queue.length >= config.audio.maxQueue) {
      throw new Error(`queue is full (${config.audio.maxQueue})`)
    }
    const item = { ...track, requestedBy, addedAt: Date.now() }
    this.queue.push(item)
    if (!this.current) this._playNext()
    return item
  }

  async _playNext() {
    this._clearIdle()
    const next = this.queue.shift()
    if (!next) {
      this.current = null
      this.gw.setPresence(null)
      this._armIdle()
      return
    }
    this.current = next
    this.startedAt = Date.now()
    if (!this.vc || this.vc._destroyed) { this.current = null; return }

    log(`player[${this.guildId}]: ▶ ${next.title}`)
    this.gw.setPresence(`🎵 ${truncate(next.title, 80)}`)
    this._announce({
      embeds: [{
        title: '▶ Now playing',
        description: next.webpageUrl ? `[${truncate(next.title, 240)}](${next.webpageUrl})` : truncate(next.title, 240),
        color: 0x22d3ee,
        fields: [
          ...(next.uploader ? [{ name: 'From', value: truncate(next.uploader, 100), inline: true }] : []),
          { name: 'Length', value: next.live ? 'live' : fmtDuration(next.duration), inline: true },
          ...(next.requestedBy ? [{ name: 'Requested by', value: `<@${next.requestedBy}>`, inline: true }] : []),
          ...(this.queue.length ? [{ name: 'Up next', value: String(this.queue.length), inline: true }] : []),
        ],
        thumbnail: next.thumbnail ? { url: next.thumbnail } : undefined,
      }],
    })

    try {
      await this.vc.play(next)
    } catch (err) {
      log(`player[${this.guildId}]: play failed ${err.message}`)
      this._announce({ content: `⚠️ Couldn't play **${truncate(next.title, 150)}** — skipping.` })
      this._onTrackEnd('error')
    }
  }

  _onTrackEnd(reason, info) {
    if (info && info.framesSent === 0 && this.current) {
      const tail = (info.stderr || '').split('\n').filter(Boolean).pop()
      this._announce({ content: `⚠️ No audio from **${truncate(this.current.title, 150)}**${tail ? ` — \`${truncate(tail, 160)}\`` : ''}. Skipping.` })
    }
    this._playNext()
  }

  _onVcClosed() {
    log(`player[${this.guildId}]: voice connection closed`)
    this.vc = null
    this.current = null
    this.queue = []
    this.gw.setPresence(null)
  }

  skip() {
    const skipped = this.current
    if (this.vc) this.vc.stopCurrent()
    // stopCurrent fires 'stopped', not 'ended' — advance manually.
    this._playNext()
    return skipped
  }

  async stop() {
    this.queue = []
    this.current = null
    await this._teardownVc()
  }

  async leave() {
    await this.stop()
  }

  remove(index) {
    if (index < 1 || index > this.queue.length) return null
    return this.queue.splice(index - 1, 1)[0]
  }

  clearQueue() {
    const n = this.queue.length
    this.queue = []
    return n
  }

  nowPlaying() {
    if (!this.current) return null
    return {
      ...this.current,
      elapsed: Math.floor((Date.now() - this.startedAt) / 1000),
    }
  }

  _armIdle() {
    this._clearIdle()
    this.idleTimer = setTimeout(() => {
      log(`player[${this.guildId}]: idle — leaving`)
      this._announce({ content: '👋 Queue finished — leaving the channel.' })
      this._teardownVc()
    }, config.audio.idleLeaveSeconds * 1000)
  }

  _clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  async _teardownVc() {
    this._clearIdle()
    const vc = this.vc
    this.vc = null
    this.current = null
    if (vc) { try { await vc.destroy() } catch {} }
  }

  async _announce(payload) {
    if (!this.textChannelId) return
    try { await sendMessage(this.textChannelId, payload) } catch (err) {
      log(`player[${this.guildId}]: announce failed ${err.message}`)
    }
  }
}

export class PlayerManager {
  constructor(gateway) {
    this.gw = gateway
    this.players = new Map()
  }

  get(guildId) {
    let p = this.players.get(guildId)
    if (!p) { p = new GuildPlayer(this, guildId); this.players.set(guildId, p) }
    return p
  }

  async shutdown() {
    await Promise.all([...this.players.values()].map(p => p.stop().catch(() => {})))
  }
}
