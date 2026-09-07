import { config, assertConfig } from './config.js'
import { log } from './lib.js'
import { GatewayClient } from './gateway.js'
import { PlayerManager } from './voice/player.js'
import { makeCommandHandler } from './commands.js'

async function main() {
  assertConfig()
  log(`fightersguild-dj starting — prefix "${config.bot.prefix}", yt-dlp ${config.audio.enableYtDlp ? 'on' : 'off'}`)

  const gateway = new GatewayClient()
  const players = new PlayerManager(gateway)
  const onMessage = makeCommandHandler(gateway, players)

  gateway.on('ready', () => log('gateway ready — DJ is online'))
  gateway.on('message', msg => { onMessage(msg).catch(err => log(`onMessage crashed: ${err.stack || err}`)) })
  gateway.on('fatal', code => { log(`fatal gateway close ${code} — exiting`); shutdown(1) })

  // If a member the bot shares a voice channel with leaves and the channel is
  // now empty, drop the connection.
  gateway.on('voiceStateUpdate', () => {
    for (const player of players.players.values()) {
      if (!player.vc) continue
      const chanId = player.vc.channelId
      let humans = 0
      for (const [uid, vs] of gateway.voiceStates) {
        if (uid !== gateway.botUserId && vs.channel_id === chanId) humans++
      }
      if (humans === 0) {
        log(`player[${player.guildId}]: channel empty — leaving`)
        player.leave().catch(() => {})
      }
    }
  })

  let stopping = false
  async function shutdown(code = 0) {
    if (stopping) return
    stopping = true
    log('shutting down…')
    try { await players.shutdown() } catch {}
    try { gateway.stop() } catch {}
    setTimeout(() => process.exit(code), 2000).unref()
  }
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  process.on('unhandledRejection', err => log(`unhandledRejection: ${err?.stack || err}`))

  await gateway.start()
}

main().catch(err => { log(`fatal: ${err.stack || err}`); process.exit(1) })
