import { config } from './config.js'
import { log, fmtDuration, truncate, isHttpUrl } from './lib.js'
import { sendMessage, startTyping } from './api.js'
import { resolveTrack } from './voice/sources.js'
import { stationList, findStation } from './voice/radio.js'

const P = config.bot.prefix

const HELP = [
  `**Fighters Guild DJ** — \`${P} <command>\``,
  '',
  `\`${P} play <search | url>\` — queue a track (YouTube/SoundCloud search, or a link)`,
  `\`${P} radio <station>\` — play an internet-radio station (\`${P} stations\` to list)`,
  `\`${P} skip\` — skip the current track`,
  `\`${P} queue\` — show the queue        \`${P} np\` — what's playing`,
  `\`${P} remove <n>\` — drop item n       \`${P} clear\` — empty the queue`,
  `\`${P} stop\` / \`${P} leave\` — stop and leave the channel`,
  `\`${P} join\` — pull the bot into your current voice channel`,
].join('\n')

export function makeCommandHandler(gateway, players) {
  return async function onMessage(msg) {
    const content = (msg.content || '').trim()
    if (!content.toLowerCase().startsWith(P.toLowerCase())) return
    if (config.bot.allowedChannelIds.length && !config.bot.allowedChannelIds.includes(msg.channel_id)) return

    const rest = content.slice(P.length).trim()
    const [cmdRaw, ...argParts] = rest.split(/\s+/)
    const cmd = (cmdRaw || 'help').toLowerCase()
    const arg = rest.slice(cmdRaw.length).trim()
    const userId = msg.author?.id
    const guildId = msg.guild_id || null

    const reply = payload =>
      sendMessage(msg.channel_id, typeof payload === 'string' ? { content: payload } : payload).catch(e => log(`reply failed: ${e.message}`))

    if (['help', 'h', ''].includes(cmd)) return reply(HELP)
    if (['stations', 'radios', 'stationlist'].includes(cmd)) {
      return reply({ embeds: [{ title: '📻 Radio stations', description: truncate(stationList(), 3800), color: 0x22d3ee }] })
    }

    if (!guildId) return reply('⚠️ DJ commands only work in a server channel.')

    const player = players.get(guildId)

    // Commands that need the caller to be in a voice channel.
    const needsVoice = ['play', 'p', 'radio', 'join', 'j'].includes(cmd)
    let voice = gateway.getUserVoice(userId)
    if (needsVoice && !voice) {
      return reply('⚠️ Join a voice channel first, then run that again.')
    }
    if (needsVoice && voice.guild_id && voice.guild_id !== guildId) {
      return reply('⚠️ Your voice channel is in another server.')
    }

    // Playback control commands require you to be in the bot's channel (or be a
    // configured DJ).
    const isDj = config.bot.djUserIds.length === 0
      ? (voice && player.vc && voice.channel_id === player.vc.channelId)
      : config.bot.djUserIds.includes(userId)
    const controlCmds = ['skip', 's', 'stop', 'leave', 'clear', 'remove', 'rm']
    if (controlCmds.includes(cmd) && player.vc && !isDj && config.bot.djUserIds.length) {
      return reply('⚠️ You are not a DJ.')
    }

    try {
      switch (cmd) {
        case 'join': case 'j': {
          await player.ensureConnected(voice.channel_id, msg.channel_id)
          return reply('✅ Connected.')
        }

        case 'play': case 'p': {
          if (!arg) return reply(`Usage: \`${P} play <search or url>\``)
          await startTyping(msg.channel_id)
          await player.ensureConnected(voice.channel_id, msg.channel_id)
          const track = await resolveTrack(arg)
          const item = player.enqueue(track, userId)
          if (player.current && player.current !== item) {
            return reply({
              embeds: [{
                description: `➕ Queued **${truncate(item.title, 200)}**${item.live ? '' : ` \`${fmtDuration(item.duration)}\``} — position ${player.queue.length}`,
                color: 0x22d3ee,
              }],
            })
          }
          return // Now-playing is announced by the player itself.
        }

        case 'radio': case 'r': {
          if (!arg) return reply(`Usage: \`${P} radio <station>\` — try \`${P} stations\``)
          if (!findStation(arg) && !isHttpUrl(arg)) return reply(`No station matches "${truncate(arg, 80)}". \`${P} stations\` to list.`)
          await player.ensureConnected(voice.channel_id, msg.channel_id)
          const track = await resolveTrack(arg)
          const item = player.enqueue(track, userId)
          if (player.current && player.current !== item) {
            return reply({ embeds: [{ description: `📻 Queued **${truncate(item.title, 200)}** — position ${player.queue.length}`, color: 0x22d3ee }] })
          }
          return
        }

        case 'skip': case 's': {
          if (!player.current) return reply('Nothing is playing.')
          const skipped = player.skip()
          return reply(`⏭ Skipped **${truncate(skipped?.title || '—', 150)}**`)
        }

        case 'np': case 'nowplaying': {
          const np = player.nowPlaying()
          if (!np) return reply('Nothing is playing.')
          const bar = np.live ? 'live' : `${fmtDuration(np.elapsed)} / ${fmtDuration(np.duration)}`
          return reply({
            embeds: [{
              title: '🎵 Now playing',
              description: np.webpageUrl ? `[${truncate(np.title, 240)}](${np.webpageUrl})` : truncate(np.title, 240),
              color: 0x22d3ee,
              fields: [{ name: 'Position', value: bar, inline: true },
                       ...(np.requestedBy ? [{ name: 'Requested by', value: `<@${np.requestedBy}>`, inline: true }] : [])],
              thumbnail: np.thumbnail ? { url: np.thumbnail } : undefined,
            }],
          })
        }

        case 'queue': case 'q': {
          const np = player.nowPlaying()
          if (!np && !player.queue.length) return reply('Queue is empty.')
          const lines = []
          if (np) lines.push(`**▶ ${truncate(np.title, 150)}** — ${np.live ? 'live' : `${fmtDuration(np.elapsed)}/${fmtDuration(np.duration)}`}`)
          player.queue.slice(0, 20).forEach((t, i) => {
            lines.push(`\`${i + 1}.\` ${truncate(t.title, 150)}${t.live ? '' : ` \`${fmtDuration(t.duration)}\``}`)
          })
          if (player.queue.length > 20) lines.push(`…and ${player.queue.length - 20} more`)
          return reply({ embeds: [{ title: `📜 Queue (${player.queue.length})`, description: truncate(lines.join('\n'), 3800), color: 0x22d3ee }] })
        }

        case 'remove': case 'rm': {
          const n = Number(arg)
          if (!Number.isInteger(n)) return reply(`Usage: \`${P} remove <number>\``)
          const removed = player.remove(n)
          return reply(removed ? `🗑 Removed **${truncate(removed.title, 150)}**` : `No item ${n} in the queue.`)
        }

        case 'clear': {
          const n = player.clearQueue()
          return reply(`🧹 Cleared ${n} item${n === 1 ? '' : 's'}.`)
        }

        case 'stop': case 'leave': case 'l': case 'dc': {
          await player.leave()
          return reply('⏹ Stopped and left the channel.')
        }

        default:
          return reply(`Unknown command \`${cmd}\`. \`${P} help\` for the list.`)
      }
    } catch (err) {
      log(`command ${cmd} failed: ${err.stack || err.message}`)
      return reply(`⚠️ ${truncate(err.message, 400)}`)
    }
  }
}
