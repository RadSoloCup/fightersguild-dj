# Fighters Guild DJ

A music / internet-radio bot for the **Fighters Guild** [Fluxer](https://fluxer.app)
server. It joins a voice channel and plays what you ask for — a search phrase, a
link, or one of a set of curated radio stations.

Fluxer runs voice over **LiveKit**. This bot speaks the same placement protocol
the desktop client does: it sends a gateway *Voice State Update*, receives a
*Voice Server Update* with a LiveKit token + endpoint, connects with
[`@livekit/rtc-node`](https://github.com/livekit/node-sdks), and publishes an
audio track fed by `ffmpeg` (and `yt-dlp` for search / links).

---

## Commands

Prefix is `!dj` (configurable).

| Command | What it does |
|---|---|
| `!dj play <search \| url>` | Queue a track — YouTube/SoundCloud search, or a direct link |
| `!dj radio <station>` | Play an internet-radio station |
| `!dj stations` | List the radio stations |
| `!dj skip` | Skip the current track |
| `!dj queue` | Show the queue |
| `!dj np` | What's playing, with elapsed time |
| `!dj remove <n>` | Drop item _n_ from the queue |
| `!dj clear` | Empty the queue |
| `!dj stop` / `!dj leave` | Stop and leave the channel |
| `!dj join` | Pull the bot into your current voice channel |

You must be in a voice channel to `play`/`radio`/`join`. Once the bot is in a
channel, anyone in that same channel can control it (or lock control to specific
users with `DJ_CONTROLLER_USER_IDS`). The bot leaves on its own when the channel
empties or after `DJ_IDLE_LEAVE_SECONDS` with nothing queued.

### Radio stations

SomaFM (Groove Salad, Drone Zone, Space Station Soma, DEF CON, Lush, Beat
Blender, Fluid, Metal Detector, The Trip, Synphaera), Nightride FM +
Darksynth, and a lofi stream. Add your own with `DJ_EXTRA_STATIONS`.

---

## Setup

1. **Create a bot.** In the Fluxer admin panel make a *second* bot application
   (separate from `sc-tools`). Copy its token.
2. **Invite it** to the guild with: View Channels, Connect, Speak, Send
   Messages, Embed Links.
3. **Configure.** Copy `.env.example` to `dj.env` and set `FLUXER_BOT_TOKEN`.
4. **Run it** next to the Fluxer stack:

   ```yaml
   # add to the fluxer compose project
   include:
     - path: ./dj/compose.snippet.yml
   ```

   or drop the `compose.snippet.yml` service into `docker-compose.yml` directly,
   then `docker compose up -d dj`.

### Local dev

```bash
npm install                 # needs a glibc host for the native LiveKit addon
FLUXER_BOT_TOKEN=… npm start
```

Requires `ffmpeg` and `yt-dlp` on `PATH` (`FFMPEG_PATH` / `YTDLP_PATH` to point
elsewhere).

---

## Networking note

The bot runs with `network_mode: host` so it reaches LiveKit the way a real
client does. This deployment's LiveKit advertises its **external** address, and a
bridged container on the same host usually can't hairpin back to it.

If the bot joins the channel but nobody hears anything, set
`LIVEKIT_ENDPOINT_OVERRIDE` to a LiveKit signalling URL the container can reach
directly (e.g. `ws://127.0.0.1:7880`, or the bridged voice-tunnel host port).

---

## Configuration

Every knob lives in the environment — see [`.env.example`](.env.example).

| Var | Default | Notes |
|---|---|---|
| `FLUXER_BOT_TOKEN` | — | **required** |
| `FLUXER_SERVER_URL` | `https://chat.example.com` | used to derive the API base |
| `BOT_PREFIX` | `!dj` | |
| `DJ_COMMAND_CHANNEL_IDS` | _(any)_ | restrict where commands work |
| `DJ_CONTROLLER_USER_IDS` | _(shared-channel)_ | lock playback control to these users |
| `DJ_VOLUME` | `0.5` | ffmpeg gain, 0–2 |
| `DJ_IDLE_LEAVE_SECONDS` | `300` | leave after this long idle |
| `DJ_MAX_TRACK_SECONDS` | `5400` | refuse longer tracks |
| `DJ_MAX_QUEUE` | `50` | per-guild queue cap |
| `DJ_ENABLE_YTDLP` | `on` | set `off` for radio + direct URLs only |
| `DJ_EXTRA_STATIONS` | — | `key\|Name\|url,…` |
| `LIVEKIT_ENDPOINT_OVERRIDE` | — | force a reachable LiveKit URL |

---

## Notes

- YouTube playback via `yt-dlp` is against YouTube's Terms of Service. It's a
  common convenience for a private, self-hosted guild bot; if you'd rather not,
  run with `DJ_ENABLE_YTDLP=off` and use radio stations + direct stream URLs.
- The bot keeps **no state** — no database, no volume.
- One track plays at a time per guild. Live streams (radio, `is_live`) play
  until skipped.

---

## License

For guild use. The Fluxer platform it connects to is
[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html).
