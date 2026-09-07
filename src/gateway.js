import { EventEmitter } from 'node:events'
import { config } from './config.js'
import { log, randomId } from './lib.js'
import { getBotGateway } from './api.js'

// Fluxer gateway opcodes (Discord-compatible; from fluxer_gateway constants.erl).
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
}

export class GatewayClient extends EventEmitter {
  constructor() {
    super()
    this.ws = null
    this.seq = null
    this.sessionId = null
    this.resumeUrl = null
    this.heartbeatTimer = null
    this.awaitingAck = false
    this.reconnectDelay = 1000
    this.botUserId = null
    this.closed = false
    // user_id -> { guild_id, channel_id, connection_id, session_id }
    this.voiceStates = new Map()
  }

  async start() {
    this.closed = false
    await this._connect()
  }

  stop() {
    this.closed = true
    this._clearHeartbeat()
    try { this.ws?.close(1000) } catch {}
  }

  // Opcode 4. Pass channelId null to leave. connectionId targets an existing
  // connection (required to leave a guild connection).
  updateVoiceState({ guildId, channelId, connectionId = null, selfMute = false, selfDeaf = false, mutationId = null }) {
    this._send(OP.VOICE_STATE_UPDATE, {
      guild_id: guildId ?? null,
      channel_id: channelId ?? null,
      connection_id: connectionId,
      self_mute: selfMute,
      self_deaf: selfDeaf,
      self_video: false,
      self_stream: false,
      ...(mutationId ? { mutation_id: mutationId } : {}),
    })
  }

  // Opcode 3 — publish a custom status (used for "Now playing").
  setPresence(text) {
    this._send(OP.PRESENCE_UPDATE, {
      status: 'online',
      afk: false,
      custom_status: text ? { text: String(text).slice(0, 128) } : null,
    })
  }

  async _connect(resume = false) {
    let base
    try {
      base = resume && this.resumeUrl ? this.resumeUrl : (await getBotGateway()).url
    } catch (err) {
      log(`gateway lookup failed (${err.message}); retrying in 15s`)
      return void setTimeout(() => this._connect(), 15_000)
    }
    const url = `${base}${base.includes('?') ? '&' : '?'}v=1&encoding=json`
    log(`connecting ${resume ? '(resume) ' : ''}${base}`)

    const ws = new WebSocket(url)
    this.ws = ws
    ws.addEventListener('message', ev => this._onMessage(ev.data, resume))
    ws.addEventListener('error', () => {})
    ws.addEventListener('close', ev => {
      this._clearHeartbeat()
      if (this.closed) return
      const fatal = [4004, 4010, 4011, 4012, 4013, 4014].includes(ev.code)
      log(`socket closed (${ev.code} ${ev.reason || ''})${fatal ? ' — FATAL, not reconnecting' : ''}`)
      if (fatal) { this.emit('fatal', ev.code); return }
      const delay = Math.min(this.reconnectDelay, 30_000)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
      setTimeout(() => this._connect(!!this.sessionId), delay + Math.random() * 500)
    })
  }

  _onMessage(raw, wasResume) {
    let msg
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) } catch { return }
    if (msg.s != null) this.seq = msg.s

    switch (msg.op) {
      case OP.HELLO:
        this._startHeartbeat(msg.d.heartbeat_interval)
        if (wasResume && this.sessionId) {
          this._send(OP.RESUME, { token: config.bot.token, session_id: this.sessionId, seq: this.seq })
        } else {
          this._identify()
        }
        break
      case OP.HEARTBEAT:
        this._send(OP.HEARTBEAT, this.seq)
        break
      case OP.HEARTBEAT_ACK:
        this.awaitingAck = false
        break
      case OP.INVALID_SESSION:
        log('invalid session, re-identifying')
        this.sessionId = null
        setTimeout(() => this._identify(), 1500 + Math.random() * 3000)
        break
      case OP.RECONNECT:
        log('server asked to reconnect')
        try { this.ws.close(4900) } catch {}
        break
      case OP.DISPATCH:
        this._onDispatch(msg.t, msg.d)
        break
    }
  }

  _onDispatch(type, d) {
    switch (type) {
      case 'READY':
        this.reconnectDelay = 1000
        this.sessionId = d.session_id || this.sessionId
        this.resumeUrl = d.resume_gateway_url || this.resumeUrl
        this.botUserId = d.user?.id ?? this.botUserId
        this._seedVoiceStates(d.guilds || [])
        log(`READY as ${d.user?.username ?? '?'} (${this.botUserId})`)
        this.emit('ready', d)
        break
      case 'RESUMED':
        log('resumed')
        break
      case 'GUILD_CREATE':
        this._seedVoiceStates([d])
        break
      case 'MESSAGE_CREATE':
        if (d.author?.id && d.author.id === this.botUserId) return
        this.emit('message', d)
        break
      case 'VOICE_STATE_UPDATE':
        this._trackVoiceState(d)
        this.emit('voiceStateUpdate', d)
        break
      case 'VOICE_SERVER_UPDATE':
        this.emit('voiceServerUpdate', d)
        break
      case 'VOICE_STATE_ACK':
        this.emit('voiceStateAck', d)
        break
    }
  }

  _seedVoiceStates(guilds) {
    for (const g of guilds) {
      for (const vs of g.voice_states || []) {
        this._trackVoiceState({ ...vs, guild_id: vs.guild_id ?? g.id })
      }
    }
  }

  _trackVoiceState(vs) {
    if (!vs?.user_id) return
    if (!vs.channel_id) {
      this.voiceStates.delete(vs.user_id)
      return
    }
    this.voiceStates.set(vs.user_id, {
      guild_id: vs.guild_id ?? null,
      channel_id: vs.channel_id,
      connection_id: vs.connection_id ?? null,
      session_id: vs.session_id ?? null,
    })
  }

  // Where is this user connected to voice right now?
  getUserVoice(userId) {
    return this.voiceStates.get(userId) || null
  }

  _identify() {
    this._send(OP.IDENTIFY, {
      token: config.bot.token,
      properties: { os: process.platform, browser: 'fightersguild-dj', device: 'fightersguild-dj' },
      presence: { status: 'online', afk: false },
      ignored_events: [
        'PRESENCE_UPDATE', 'TYPING_START',
        'GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE', 'GUILD_MEMBER_REMOVE',
        'CHANNEL_PINS_UPDATE', 'MESSAGE_REACTION_ADD', 'MESSAGE_REACTION_REMOVE',
        'MESSAGE_UPDATE', 'MESSAGE_DELETE',
      ],
    })
  }

  _startHeartbeat(interval) {
    this._clearHeartbeat()
    setTimeout(() => {
      this._beat()
      this.heartbeatTimer = setInterval(() => this._beat(), interval)
    }, interval * Math.random())
  }

  _beat() {
    if (this.awaitingAck) {
      log('missed heartbeat ack, cycling socket')
      try { this.ws.close(4900) } catch {}
      return
    }
    this.awaitingAck = true
    this._send(OP.HEARTBEAT, this.seq)
  }

  _clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.awaitingAck = false
  }

  _send(op, d) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op, d }))
      }
    } catch (err) {
      log(`send failed (op ${op}): ${err.message}`)
    }
  }
}

export { randomId }
