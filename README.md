# Fighters Guild DJ

A music and internet radio bot for the Fighters Guild
[Fluxer](https://github.com/fluxerapp/fluxer) server. It joins a voice channel
and plays what you ask for: a search phrase, a direct link, or one of a set of
curated radio stations.

Part of the Fighters Guild toolset alongside the
[desktop client](https://github.com/RadSoloCup/fightersguild-app),
[Portal](https://github.com/RadSoloCup/fightersguild-portal),
[Star Citizen tools](https://github.com/RadSoloCup/fightersguild-sc-tools), and
[Discord bridge](https://github.com/RadSoloCup/fightersguild-crosstalk).

## How it plays audio

Fluxer runs voice over **LiveKit**. This bot speaks the same placement protocol
the desktop client does. It sends a gateway Voice State Update, receives a Voice
Server Update with a LiveKit token and endpoint, connects with
[`@livekit/rtc-node`](https://github.com/livekit/node-sdks), and publishes an
audio track fed by `ffmpeg`. Search terms and links are resolved by `yt-dlp`
piped into `ffmpeg`.

---

## Commands

Prefix is `!dj`, configurable with `BOT_PREFIX`.

| Command | What it does |
|---|---|
| `!dj play <search \| url>` | queue a track: YouTube or SoundCloud search, or a direct link |
| `!dj radio <station>` | play an internet radio station |
| `!dj stations` | list the radio stations |
| `!dj skip` | skip the current track |
| `!dj queue` | show the queue |
| `!dj np` | what is playing, with elapsed time |
| `!dj remove <n>` | drop item n from the queue |
| `!dj clear` | empty the queue |
| `!dj stop` / `!dj leave` | stop and leave the channel |
| `!dj join` | pull the bot into your current voice channel |

You must be in a voice channel to `play`, `radio`, or `join`. Once the bot is in
a channel, anyone in that same channel can control it, or you can lock control to
specific users with `DJ_CONTROLLER_USER_IDS`. The bot leaves on its own when the
channel empties, or after `DJ_IDLE_LEAVE_SECONDS` with nothing queued.

One track plays at a time per guild. Live streams (radio) play until skipped.
The bot keeps no state: no database, no volume.

### Radio stations

| Source | Stations | Support them |
|---|---|---|
| [**THE BASE**](https://thebase.sc) | Star Citizen spacewave radio (`thebase`) | fan run, support via their site |
| [**Space Travel Radio**](https://www.spacetravelradio.de) | Star Citizen ambient, chillout, soundtrack (`str`) | non commercial fan project |
| [**SomaFM**](https://somafm.com) | Mission Control, Deep Space One, Space Station Soma, Drone Zone, Synphaera, Groove Salad, Vaporwaves, DEF CON, Beat Blender, The Trip, Lush, Fluid, Metal Detector | listener supported, commercial free, [donate to SomaFM](https://somafm.com/support/) |
| [**Nightride FM**](https://nightride.fm) | Nightride, Darksynth | [support Nightride FM](https://nightride.fm/support) |
| [**FluxFM**](https://www.fluxfm.de) | Chillhop / lofi | |

Add your own with `DJ_EXTRA_STATIONS`. If you run this bot, please chip in to the
stations you play. SomaFM in particular runs entirely on listener donations.

---

## Setup

1. **Create a bot.** In the chat server's admin panel make a bot application,
   separate from the other guild bots. Copy its token.
2. **Invite it** to the guild with View Channels, Connect, Speak, Send Messages,
   and Embed Links.
3. **Configure.** Copy `.env.example` to `dj.env` and set `FLUXER_BOT_TOKEN` and
   `FLUXER_SERVER_URL`.
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
FLUXER_BOT_TOKEN=... npm start
```

Requires `ffmpeg` and `yt-dlp` on `PATH`. Set `FFMPEG_PATH` or `YTDLP_PATH` to
point elsewhere.

---

## Networking note

The bot runs with `network_mode: host` so it reaches LiveKit the way a real
client does. This deployment's LiveKit advertises its external address, and a
bridged container on the same host usually cannot hairpin back to it.

If the bot joins the channel but nobody hears anything, set
`LIVEKIT_ENDPOINT_OVERRIDE` to a LiveKit signalling URL the container can reach
directly, for example `ws://127.0.0.1:7880` or a bridged voice tunnel host port.

---

## Configuration

Every knob lives in the environment, see [`.env.example`](.env.example).

| Var | Default | Notes |
|---|---|---|
| `FLUXER_BOT_TOKEN` | | required |
| `FLUXER_SERVER_URL` | `https://chat.example.com` | used to derive the API base |
| `BOT_PREFIX` | `!dj` | |
| `DJ_COMMAND_CHANNEL_IDS` | any | restrict where commands work |
| `DJ_CONTROLLER_USER_IDS` | shared channel | lock playback control to these users |
| `DJ_VOLUME` | `0.5` | ffmpeg gain, 0 to 2 |
| `DJ_IDLE_LEAVE_SECONDS` | `300` | leave after this long idle |
| `DJ_MAX_TRACK_SECONDS` | `5400` | refuse longer tracks |
| `DJ_MAX_QUEUE` | `50` | per guild queue cap |
| `DJ_ENABLE_YTDLP` | `on` | set `off` for radio and direct URLs only |
| `DJ_EXTRA_STATIONS` | | `key\|Name\|url,...` |
| `LIVEKIT_ENDPOINT_OVERRIDE` | | force a reachable LiveKit URL |

---

## Notes

YouTube playback through `yt-dlp` is against YouTube's Terms of Service. It is a
common convenience for a private self hosted guild bot. If you would rather not,
run with `DJ_ENABLE_YTDLP=off` and use radio stations and direct stream URLs.

## Credits

| | | License |
|---|---|---|
| [**LiveKit**](https://livekit.io) and [`@livekit/rtc-node`](https://github.com/livekit/node-sdks) | WebRTC media transport, the bot publishes audio through it | Apache-2.0 |
| [**FFmpeg**](https://ffmpeg.org) | decodes and transcodes every source to PCM, external binary | LGPL-2.1 or GPL depending on build |
| [**yt-dlp**](https://github.com/yt-dlp/yt-dlp) | resolves search terms and links to a stream, external binary | Unlicense, public domain |
| [**Fluxer**](https://github.com/fluxerapp/fluxer) | the chat platform and voice protocol this bot speaks | AGPL-3.0 |
| [**THE BASE**](https://thebase.sc), [**Space Travel Radio**](https://www.spacetravelradio.de), [**SomaFM**](https://somafm.com), [**Nightride FM**](https://nightride.fm), [**FluxFM**](https://www.fluxfm.de) | the built in radio stations, please [support them](#radio-stations) | their own |

Not affiliated with any of the above.

## License

Copyright &copy; 2026 Fighters Guild. Licensed under the
[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html), see [`LICENSE`](LICENSE).

If you run a modified version of this bot as a service, the AGPL requires you to
make your source available to its users.

---

Made in Canada 🇨🇦
