import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node'
import { config } from '../config.js'
import { log, randomId } from '../lib.js'

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const FRAME_MS = 20
const SAMPLES_PER_CHANNEL = (SAMPLE_RATE * FRAME_MS) / 1000 // 960
const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * CHANNELS * 2 // 3840

// One live voice connection: the op4 handshake, the LiveKit room, and the
// ffmpeg -> PCM -> track pump for the currently playing source.
export class VoiceConnection extends EventEmitter {
  constructor(gateway, { guildId, channelId }) {
    super()
    this.gw = gateway
    this.guildId = guildId
    this.channelId = channelId
    this.connectionId = null
    this.room = null
    this.source = null
    this.track = null
    this.ffmpeg = null
    this.ytdlp = null
    this._playToken = 0
    this._destroyed = false
  }

  async connect() {
    const mutationId = randomId()
    const grant = await this._handshake(mutationId)
    this.connectionId = grant.connection_id

    const endpoint = config.livekit.endpointOverride || grant.endpoint
    log(`voice: connecting to LiveKit ${endpoint} (conn ${this.connectionId})`)

    const room = new Room()
    this.room = room
    room.on(RoomEvent.Disconnected, () => {
      log('voice: LiveKit room disconnected')
      if (!this._destroyed) this.emit('closed')
    })

    await room.connect(endpoint, grant.token, { autoSubscribe: false, dynacast: false })

    this.source = new AudioSource(SAMPLE_RATE, CHANNELS)
    this.track = LocalAudioTrack.createAudioTrack('music', this.source)
    const opts = new TrackPublishOptions()
    opts.source = TrackSource.SOURCE_MICROPHONE
    await room.localParticipant.publishTrack(this.track, opts)
    log('voice: audio track published')
  }

  _handshake(mutationId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('timed out waiting for VOICE_SERVER_UPDATE'))
      }, 15_000)

      const onServer = d => {
        if (d.channel_id !== this.channelId) return
        cleanup()
        resolve(d)
      }
      const onAck = d => {
        if (d.mutation_id !== mutationId) return
        if (d.status === 'rejected') {
          cleanup()
          reject(new Error(d.error_code || d.error_message || 'voice state rejected'))
        }
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.gw.off('voiceServerUpdate', onServer)
        this.gw.off('voiceStateAck', onAck)
      }

      this.gw.on('voiceServerUpdate', onServer)
      this.gw.on('voiceStateAck', onAck)
      this.gw.updateVoiceState({
        guildId: this.guildId,
        channelId: this.channelId,
        mutationId,
      })
    })
  }

  // Play one track to completion. Resolves 'ended' on natural end, 'stopped'
  // if stopCurrent()/destroy() interrupted it. `track` is a resolved object
  // from sources.js: { streamUrl, webpageUrl, fetchVia }.
  async play(track) {
    this.stopCurrent()
    const myToken = ++this._playToken
    const source = this.source
    if (!source) throw new Error('not connected')

    let stderr = ''
    const addErr = (tag, d) => {
      stderr += `${tag}${d.toString()}`
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    }

    // For resolver sources (YouTube/SoundCloud/…) let yt-dlp do the fetch and
    // pipe raw media into ffmpeg — far more reliable than handing ffmpeg a
    // googlevideo URL directly. Radio and plain URLs go straight to ffmpeg.
    const useYtdlp = track.fetchVia === 'ytdlp' && track.webpageUrl
    let yt = null
    let ffInput = track.streamUrl

    if (useYtdlp) {
      yt = spawn(config.audio.ytDlpPath, [
        '-q', '--no-warnings', '--no-playlist',
        '-f', 'bestaudio[protocol^=http]/bestaudio/best',
        '-o', '-', '--', track.webpageUrl,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      this.ytdlp = yt
      yt.stderr.on('data', d => addErr('[yt] ', d))
      yt.on('error', err => addErr('[yt] spawn ', Buffer.from(err.message)))
      ffInput = 'pipe:0'
    }

    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
    ]
    if (!useYtdlp) args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5')
    args.push(
      '-i', ffInput,
      '-vn', '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE),
      '-af', `volume=${config.audio.volume}`,
      '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
    )

    const ff = spawn(config.audio.ffmpegPath, args, { stdio: [useYtdlp ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    this.ffmpeg = ff
    if (yt) {
      yt.stdout.pipe(ff.stdin)
      ff.stdin.on('error', () => {}) // yt-dlp exiting first closes the pipe
    }
    ff.stderr.on('data', d => addErr('', d))

    let pending = Buffer.alloc(0)
    let streamEnded = false
    let pumping = false
    let finished = false
    let framesSent = 0

    const finish = reason => {
      if (finished) return
      finished = true
      if (this.ffmpeg === ff) this.ffmpeg = null
      if (this.ytdlp === yt) this.ytdlp = null
      try { ff.kill('SIGKILL') } catch {}
      try { yt?.kill('SIGKILL') } catch {}
      this.emit(reason, { stderr, framesSent })
    }

    const pump = async () => {
      if (pumping || myToken !== this._playToken) return
      pumping = true
      try {
        while (pending.length >= BYTES_PER_FRAME) {
          if (myToken !== this._playToken) { finish('stopped'); return }
          const frameBuf = new Uint8Array(BYTES_PER_FRAME)
          frameBuf.set(pending.subarray(0, BYTES_PER_FRAME))
          pending = pending.subarray(BYTES_PER_FRAME)
          const i16 = new Int16Array(frameBuf.buffer, 0, SAMPLES_PER_CHANNEL * CHANNELS)
          await source.captureFrame(new AudioFrame(i16, SAMPLE_RATE, CHANNELS, SAMPLES_PER_CHANNEL))
          framesSent++
          drainCheck()
        }
        if (streamEnded && pending.length < BYTES_PER_FRAME) {
          if (pending.length > 0) {
            const padded = new Uint8Array(BYTES_PER_FRAME)
            padded.set(pending)
            const i16 = new Int16Array(padded.buffer, 0, SAMPLES_PER_CHANNEL * CHANNELS)
            await source.captureFrame(new AudioFrame(i16, SAMPLE_RATE, CHANNELS, SAMPLES_PER_CHANNEL))
            pending = Buffer.alloc(0)
          }
          try { await source.waitForPlayout() } catch {}
          finish(myToken === this._playToken ? 'ended' : 'stopped')
        }
      } catch (err) {
        log(`voice: pump error ${err.message}`)
        finish('stopped')
      } finally {
        pumping = false
      }
    }

    // captureFrame paces at real time, but ffmpeg decodes a file/stream far
    // faster — so back-pressure its stdout instead of buffering the whole track.
    const HIGH_WATER = 3 * 1024 * 1024
    const LOW_WATER = 512 * 1024
    let paused = false
    ff.stdout.on('data', chunk => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      if (!paused && pending.length > HIGH_WATER) { paused = true; ff.stdout.pause() }
      pump()
    })
    const drainCheck = () => {
      if (paused && pending.length < LOW_WATER) { paused = false; ff.stdout.resume() }
    }
    ff.stdout.on('end', () => { streamEnded = true; pump() })
    ff.on('error', err => { stderr += `\nspawn: ${err.message}`; finish('stopped') })
    ff.on('close', code => {
      streamEnded = true
      if (code && code !== 0 && !finished && pending.length < BYTES_PER_FRAME) {
        log(`voice: ffmpeg exited ${code}: ${stderr.split('\n').pop()}`)
      }
      pump()
    })
  }

  stopCurrent() {
    this._playToken++
    if (this.ytdlp) {
      try { this.ytdlp.kill('SIGKILL') } catch {}
      this.ytdlp = null
    }
    if (this.ffmpeg) {
      try { this.ffmpeg.kill('SIGKILL') } catch {}
      this.ffmpeg = null
    }
  }

  async destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this.stopCurrent()
    try { this.gw.setPresence(null) } catch {}
    if (this.connectionId) {
      try {
        this.gw.updateVoiceState({
          guildId: this.guildId,
          channelId: null,
          connectionId: this.connectionId,
        })
      } catch {}
    }
    try { await this.track?.close() } catch {}
    try { await this.room?.disconnect() } catch {}
    this.room = null
    this.source = null
    this.track = null
  }
}
