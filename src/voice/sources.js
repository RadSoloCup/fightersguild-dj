import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.js'
import { isHttpUrl } from '../lib.js'
import { findStation } from './radio.js'

const execFileP = promisify(execFile)

// Hosts we hand straight to ffmpeg as a live stream rather than resolving.
const DIRECT_AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|flac|wav|m3u8|pls)(\?|$)/i

// A resolved track:
//   { title, streamUrl, webpageUrl, duration, thumbnail, live, source, fetchVia }
// fetchVia: 'ffmpeg' (hand the URL straight to ffmpeg) or 'ytdlp' (let yt-dlp
// fetch and pipe into ffmpeg).
export async function resolveTrack(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('nothing to play')

  // 1. A known radio station key/name.
  const station = findStation(raw)
  if (station && !isHttpUrl(raw)) {
    return { title: station.name, streamUrl: station.url, duration: 0, webpageUrl: null, thumbnail: null, live: true, source: 'radio', fetchVia: 'ffmpeg' }
  }

  // 2. A bare http(s) URL.
  if (isHttpUrl(raw)) {
    const host = new URL(raw).hostname.replace(/^www\./, '')
    const looksDirect = DIRECT_AUDIO_EXT.test(raw)
    const resolverHost = /youtube\.com|youtu\.be|soundcloud\.com|bandcamp\.com|twitch\.tv|vimeo\.com|mixcloud\.com/i.test(host)
    if (config.audio.enableYtDlp && resolverHost && !looksDirect) {
      return ytdlp(raw)
    }
    return { title: host, streamUrl: raw, duration: 0, webpageUrl: raw, thumbnail: null, live: true, source: 'url', fetchVia: 'ffmpeg' }
  }

  // 3. A search phrase.
  if (!config.audio.enableYtDlp) {
    throw new Error(`"${raw}" isn't a station or URL, and search is disabled`)
  }
  return ytdlp(`ytsearch1:${raw}`)
}

async function ytdlp(target) {
  const args = [
    '-q', '--no-warnings', '--no-playlist', '--no-call-home',
    '-f', 'bestaudio[protocol^=http]/bestaudio/best',
    '-J', '--',
    target,
  ]
  let stdout
  try {
    ({ stdout } = await execFileP(config.audio.ytDlpPath, args, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
    }))
  } catch (err) {
    const msg = (err.stderr || err.message || '').split('\n').filter(Boolean).pop() || 'yt-dlp failed'
    throw new Error(msg.replace(/^ERROR:\s*/i, '').slice(0, 300))
  }

  let info = JSON.parse(stdout)
  if (info._type === 'playlist' && Array.isArray(info.entries)) info = info.entries[0]
  if (!info) throw new Error('no results')

  const streamUrl = info.url || pickFormatUrl(info)
  if (!streamUrl) throw new Error('could not extract an audio stream')

  const duration = Number(info.duration) || 0
  if (duration && duration > config.audio.maxTrackSeconds) {
    throw new Error(`track is ${Math.round(duration / 60)} min — over the ${Math.round(config.audio.maxTrackSeconds / 60)} min limit`)
  }

  const webpageUrl = info.webpage_url || (typeof target === 'string' && isHttpUrl(target) ? target : null)
  return {
    title: info.title || info.fulltitle || 'Unknown',
    streamUrl,
    webpageUrl,
    duration,
    thumbnail: bestThumb(info),
    live: !!info.is_live || duration === 0,
    source: info.extractor_key || 'yt-dlp',
    uploader: info.uploader || info.channel || null,
    // Prefer piping through yt-dlp when we have a page URL to hand it.
    fetchVia: webpageUrl ? 'ytdlp' : 'ffmpeg',
  }
}

function pickFormatUrl(info) {
  const fmts = Array.isArray(info.formats) ? info.formats : []
  const audio = fmts.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url)
  audio.sort((a, b) => (b.abr || 0) - (a.abr || 0))
  return audio[0]?.url || fmts.find(f => f.url)?.url || null
}

function bestThumb(info) {
  if (info.thumbnail) return info.thumbnail
  const t = Array.isArray(info.thumbnails) ? info.thumbnails : []
  return t.length ? t[t.length - 1].url : null
}
