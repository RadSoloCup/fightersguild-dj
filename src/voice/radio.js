// Curated internet-radio stations. Direct Icecast/SHOUTcast streams — no
// resolver needed, ffmpeg plays them straight. Add your own with
// DJ_EXTRA_STATIONS='key|Name|https://stream.url,key2|Name2|https://…'
const BUILTIN = [
  // --- Star Citizen fan stations ---
  { key: 'thebase', name: 'THE BASE — Star Citizen Radio', url: 'https://listen.thebase.sc/', tags: 'star citizen spacewave verse' },
  { key: 'str', name: 'Space Travel Radio', url: 'https://spacetravelradio.de:2893/stream/2/', tags: 'star citizen ambient chillout soundtrack' },
  // --- Space / ambient ---
  { key: 'missioncontrol', name: 'SomaFM: Mission Control', url: 'https://ice1.somafm.com/missioncontrol-128-mp3', tags: 'space nasa ambient' },
  { key: 'deepspaceone', name: 'SomaFM: Deep Space One', url: 'https://ice1.somafm.com/deepspaceone-128-mp3', tags: 'space ambient experimental' },
  { key: 'spacestation', name: 'SomaFM: Space Station Soma', url: 'https://ice1.somafm.com/spacestation-128-mp3', tags: 'spacemusic' },
  { key: 'dronezone', name: 'SomaFM: Drone Zone', url: 'https://ice1.somafm.com/dronezone-256-mp3', tags: 'ambient space' },
  { key: 'synphaera', name: 'SomaFM: Synphaera', url: 'https://ice1.somafm.com/synphaera-256-mp3', tags: 'ambient electronic space' },
  { key: 'groovesalad', name: 'SomaFM: Groove Salad', url: 'https://ice1.somafm.com/groovesalad-256-mp3', tags: 'ambient downtempo' },
  // --- Synthwave / electronic ---
  { key: 'nightride', name: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.mp3', tags: 'synthwave' },
  { key: 'darksynth', name: 'Nightride FM: Darksynth', url: 'https://stream.nightride.fm/darksynth.mp3', tags: 'darksynth' },
  { key: 'vaporwaves', name: 'SomaFM: Vaporwaves', url: 'https://ice1.somafm.com/vaporwaves-128-mp3', tags: 'vaporwave' },
  { key: 'defcon', name: 'SomaFM: DEF CON Radio', url: 'https://ice1.somafm.com/defcon-256-mp3', tags: 'hacker beats' },
  { key: 'beatblender', name: 'SomaFM: Beat Blender', url: 'https://ice1.somafm.com/beatblender-128-mp3', tags: 'deep house' },
  { key: 'thetrip', name: 'SomaFM: The Trip', url: 'https://ice1.somafm.com/thetrip-128-mp3', tags: 'progressive house' },
  // --- Chill / misc ---
  { key: 'lush', name: 'SomaFM: Lush', url: 'https://ice1.somafm.com/lush-128-mp3', tags: 'vocal chill' },
  { key: 'fluid', name: 'SomaFM: Fluid', url: 'https://ice1.somafm.com/fluid-128-mp3', tags: 'instrumental hiphop' },
  { key: 'metal', name: 'SomaFM: Metal Detector', url: 'https://ice1.somafm.com/metal-128-mp3', tags: 'metal' },
  { key: 'chillhop', name: 'Chillhop / lofi', url: 'https://streams.fluxfm.de/Chillhop/mp3-320/streams.fluxfm.de/', tags: 'lofi beats' },
]

function parseExtra() {
  const raw = process.env.DJ_EXTRA_STATIONS || ''
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const [key, name, url] = entry.split('|').map(x => x.trim())
    return key && url ? { key: key.toLowerCase(), name: name || key, url, tags: '' } : null
  }).filter(Boolean)
}

export const STATIONS = [...BUILTIN, ...parseExtra()]

export function findStation(query) {
  const q = String(query || '').toLowerCase().trim()
  if (!q) return null
  return (
    STATIONS.find(s => s.key === q) ||
    STATIONS.find(s => s.name.toLowerCase() === q) ||
    STATIONS.find(s => s.key.includes(q) || s.name.toLowerCase().includes(q) || s.tags.includes(q)) ||
    null
  )
}

export function stationList() {
  return STATIONS.map(s => `\`${s.key}\` — ${s.name}`).join('\n')
}
