// Configuration from environment.
const env = process.env

function apiBase() {
  if (env.FLUXER_API_BASE) return env.FLUXER_API_BASE.replace(/\/$/, '')
  try { return new URL(env.FLUXER_SERVER_URL).origin } catch {}
  return 'https://chat.example.com'
}

export const config = {
  userAgent:
    env.USER_AGENT ||
    'fightersguild-dj (+https://github.com/RadSoloCup/fightersguild-dj)',

  bot: {
    token: env.FLUXER_BOT_TOKEN || null,
    apiBase: apiBase(),
    prefix: env.BOT_PREFIX || '!dj',
    // Restrict command handling to these channel IDs (comma-separated). Empty = any.
    allowedChannelIds: (env.DJ_COMMAND_CHANNEL_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    // Only these user IDs may control playback (comma-separated). Empty = anyone
    // who is in the voice channel with the bot.
    djUserIds: (env.DJ_CONTROLLER_USER_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
  },

  livekit: {
    // The endpoint Fluxer hands back in VOICE_SERVER_UPDATE points at the public
    // playit URL. When the bot runs on the same host as LiveKit that path can
    // hairpin; set this to force a reachable signalling URL instead, e.g.
    //   ws://127.0.0.1:7880   (direct to the LiveKit container's ws port)
    // Leave unset to use whatever Fluxer returns.
    endpointOverride: env.LIVEKIT_ENDPOINT_OVERRIDE || null,
  },

  audio: {
    // 0.0 - 2.0 playback gain applied by ffmpeg.
    volume: clampNum(env.DJ_VOLUME, 0.5, 0, 2),
    // Leave the channel after this many seconds with an empty queue.
    idleLeaveSeconds: clampNum(env.DJ_IDLE_LEAVE_SECONDS, 300, 30, 3600),
    // Hard cap on a single track's length (seconds); longer ones are refused.
    maxTrackSeconds: clampNum(env.DJ_MAX_TRACK_SECONDS, 5400, 60, 86400),
    // Max queued items per guild.
    maxQueue: clampNum(env.DJ_MAX_QUEUE, 50, 1, 500),
    ytDlpPath: env.YTDLP_PATH || 'yt-dlp',
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    // Allow yt-dlp resolution (YouTube/SoundCloud/etc. search + links).
    enableYtDlp: env.DJ_ENABLE_YTDLP !== 'off',
  },
}

function clampNum(raw, dflt, lo, hi) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

export function assertConfig() {
  if (!config.bot.token) throw new Error('FLUXER_BOT_TOKEN is required')
  if (!config.bot.apiBase) throw new Error('Could not determine API base — set FLUXER_API_BASE')
}
