const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');
const { WebSocketServer } = require('ws');
const dbus = require('dbus-next');

const PORT = process.env.PORT || 8080;
const COVERART_DIR = '/tmp/shairport-sync/.cache/coverart';

const EXEC_ENV = {
  ...process.env,
  DISPLAY: process.env.DISPLAY || ':0',
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000'
};

let wasActivePlayback = false;
function wakeDisplayIfNeeded(isNowPlaying) {
  if (isNowPlaying && !wasActivePlayback) {
    const cmd = 'wlopm --on "*" 2>/dev/null || (DISPLAY=:0 xdotool key --window 0 shift 2>/dev/null)';
    child_process.exec(cmd, { env: EXEC_ENV }, () => {});
  }
  wasActivePlayback = isNowPlaying;
}


const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Recursively unwrap D-Bus Variant, Map, Array, BigInt objects into clean JS
function unwrap(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object') {
    if ('value' in val && 'signature' in val) {
      return unwrap(val.value);
    }
    if (val instanceof Map) {
      const obj = {};
      for (const [k, v] of val.entries()) {
        obj[k] = unwrap(v);
      }
      return obj;
    }
    if (Array.isArray(val)) {
      return val.map(unwrap);
    }
    const res = {};
    for (const k of Object.keys(val)) {
      res[k] = unwrap(val[k]);
    }
    return res;
  }
  return val;
}

// Global state
let state = {
  playback: {
    status: 'Stopped',
    title: '',
    artist: '',
    album: '',
    genre: '',
    composer: '',
    trackNumber: null,
    durationMs: 0,
    positionMs: 0,
    positionUpdatedAt: Date.now(),
    volume: null,
    airplayVolumeDb: null,
    artworkUrl: null,
    artworkFile: null,
    hasArtwork: false,
    colors: null
  },
  receiver: {
    active: false,
    protocol: 'AirPlay 2',
    serviceName: 'AirPlay',
    clientIp: '',
    clientName: '',
    streamType: '',
    sourceFormat: '',
    outputFormat: '',
    alsaDevice: 'hw:Headphones',
    version: '',
    versionString: '',
    driftTolerance: 0.002,
    interpolation: 'Vernier',
    alacDecoder: 'FFmpeg',
    volumeControlProfile: 'Standard',
    loudnessEnabled: false,
    loudnessThreshold: null,
    convolutionEnabled: false,
    firstFramePosition: '',
    framePosition: '',
    nqptpActive: true,
    nqptpMasterClockId: '',
    nqptpOffsetNs: 0,
    nqptpDriftNs: 0,
    nqptpJitterUs: 0
  },
  system: {
    hostname: os.hostname(),
    temperatureC: null,
    cpuLoad: 0,
    cpuLoad5: 0,
    cpuLoad15: 0,
    cpuCount: os.cpus().length,
    cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'Cortex-A72',
    memTotalMb: 0,
    memUsedMb: 0,
    memFreeMb: 0,
    memPercent: 0,
    uptimeSec: 0,
    timestamp: Date.now()
  }
};

// SVG Placeholder when no album art is available
const PLACEHOLDER_SVG = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1c1c22"/>
      <stop offset="100%" stop-color="#0a0a0d"/>
    </linearGradient>
    <linearGradient id="pink" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fa2d55"/>
      <stop offset="100%" stop-color="#ff375f"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="56" fill="url(#g)"/>
  <circle cx="256" cy="256" r="160" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>
  <circle cx="256" cy="256" r="110" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="2"/>
  <g transform="translate(186, 176) scale(0.7)">
    <path fill="url(#pink)" d="M192 0c17.7 0 32 14.3 32 32V180.2c2.7-.1 5.3-.2 8-.2 44.2 0 80 35.8 80 80s-35.8 80-80 80-80-35.8-80-80c0-1.8.1-3.6.2-5.4V89.8L32 119.5v120.7c2.7-.1 5.3-.2 8-.2 44.2 0 80 35.8 80 80s-35.8 80-80 80-80-35.8-80-80c0-1.8.1-3.6.2-5.4V32C40 14.3 54.3 0 72 0l120 0z"/>
  </g>
</svg>
`.trim());

// Track last PTP offset for true nanosecond jitter calculation
let lastNqptpOffset = null;

// Update Pi system and real NQPTP metrics
function updateSystemMetrics() {
  try {
    if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
      const rawTemp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
      state.system.temperatureC = +(parseFloat(rawTemp) / 1000).toFixed(1);
    }
  } catch (e) {
    state.system.temperatureC = null;
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  state.system.memTotalMb = Math.round(totalMem / (1024 * 1024));
  state.system.memUsedMb = Math.round(usedMem / (1024 * 1024));
  state.system.memFreeMb = Math.round(freeMem / (1024 * 1024));
  state.system.memPercent = Math.round((usedMem / totalMem) * 100);

  const loads = os.loadavg();
  state.system.cpuLoad = +(loads[0] || 0).toFixed(2);
  state.system.cpuLoad5 = +(loads[1] || 0).toFixed(2);
  state.system.cpuLoad15 = +(loads[2] || 0).toFixed(2);
  state.system.uptimeSec = Math.floor(os.uptime());
  state.system.kernel = `${os.type()} ${os.release()} ${os.arch()}`;
  state.system.timestamp = Date.now();

  // Read REAL NQPTP shared memory (/dev/shm/nqptp)
  try {
    if (fs.existsSync('/dev/shm/nqptp')) {
      const buf = fs.readFileSync('/dev/shm/nqptp');
      if (buf.length >= 88) {
        state.receiver.nqptpActive = true;
        state.receiver.nqptpMasterClockId = '0x' + buf.readBigUInt64LE(8).toString(16);
        const offset = Number(buf.readBigInt64LE(24));
        state.receiver.nqptpOffsetNs = offset;
        
        if (lastNqptpOffset !== null) {
          const drift = offset - lastNqptpOffset;
          state.receiver.nqptpDriftNs = drift;
          state.receiver.nqptpJitterUs = +(drift / 1000).toFixed(2);
        }
        lastNqptpOffset = offset;
      }
    } else {
      state.receiver.nqptpActive = false;
    }
  } catch (e) {
    state.receiver.nqptpActive = false;
  }
}

// Safe artwork path resolver
function resolveArtworkPath(artUrl) {
  if (!artUrl || typeof artUrl !== 'string') return null;

  let localPath = artUrl;
  if (localPath.startsWith('file://')) {
    localPath = decodeURIComponent(localPath.substring(7));
  }

  const resolved = path.resolve(localPath);
  const normalizedCoverDir = path.resolve(COVERART_DIR);

  if (resolved.startsWith(normalizedCoverDir + path.sep) || resolved === normalizedCoverDir) {
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  const candidate = path.resolve(COVERART_DIR, path.basename(localPath));
  if (candidate.startsWith(normalizedCoverDir + path.sep) && fs.existsSync(candidate)) {
    return candidate;
  }

  return null;
}

// In-memory cache for dynamic artwork palette
const paletteCache = new Map();

function extractPaletteFromImage(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  if (paletteCache.has(filePath)) return paletteCache.get(filePath);

  try {
    const pyCode = `
import sys
from PIL import Image
try:
    img = Image.open("${filePath}").convert("RGB").resize((24, 24))
    pixels = list(img.getdata())
    best = (250, 45, 85)
    max_score = -1
    for r, g, b in pixels:
        mx, mn = max(r, g, b), min(r, g, b)
        delta = mx - mn
        bright = (r + g + b) / 3.0
        if 40 < bright < 220 and delta > 25:
            score = delta * 1.5 + bright * 0.5
            if score > max_score:
                max_score = score
                best = (r, g, b)
    print(f"{best[0]},{best[1]},{best[2]}")
except Exception:
    print("250,45,85")
`;
    const out = child_process.execFileSync('python3', ['-c', pyCode], { timeout: 600, encoding: 'utf8' }).trim();
    const parts = out.split(',').map(n => parseInt(n, 10));
    if (parts.length === 3 && !parts.some(isNaN)) {
      const colors = {
        primary: `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`,
        ambient: `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, 0.45)`,
        glow: `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, 0.65)`
      };
      paletteCache.set(filePath, colors);
      return colors;
    }
  } catch (e) {
    console.error('Palette extraction error:', e.message);
  }

  const fallback = {
    primary: '#fa2d55',
    ambient: 'rgba(250, 45, 85, 0.45)',
    glow: 'rgba(250, 45, 85, 0.65)'
  };
  paletteCache.set(filePath, fallback);
  return fallback;
}

// SSE Clients List
let sseClients = [];

// Broadcast state to all connected WebSocket and SSE clients
function broadcastState() {
  const payload = JSON.stringify({ type: 'state', data: state });
  
  // WebSocket clients
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch (e) {}
    }
  }

  // SSE clients
  const sseMsg = `data: ${payload}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(sseMsg);
    } catch (e) {
      sseClients.splice(i, 1);
    }
  }
}

// Connect to D-Bus and monitor Shairport Sync
let dbusBus = null;
let mprisPlayerProps = null;
let spsBaseProps = null;
let spsRemoteProps = null;

// Check actual ALSA hardware PCM state from /proc/asound
function getAlsaHardwareStatus() {
  try {
    const cards = fs.readdirSync('/proc/asound');
    for (const c of cards) {
      if (c.startsWith('card')) {
        const pcmStatusPath = `/proc/asound/${c}/pcm0p/sub0/status`;
        if (fs.existsSync(pcmStatusPath)) {
          const content = fs.readFileSync(pcmStatusPath, 'utf8');
          if (content.includes('state: RUNNING')) {
            const mHw = content.match(/hw_ptr\s*:\s*(\d+)/);
            const mDelay = content.match(/delay\s*:\s*(\d+)/);
            const delayFrames = mDelay ? parseInt(mDelay[1], 10) : 0;
            const bufferTotal = 32768; // 32,768 frames hardware buffer
            const bufferPercent = Math.min(100, +((delayFrames / bufferTotal) * 100).toFixed(1));
            const bufferMs = +((delayFrames / 48000) * 1000).toFixed(1);
            return {
              running: true,
              card: c,
              hwPtr: mHw ? parseInt(mHw[1], 10) : 0,
              delayFrames,
              bufferPercent,
              bufferMs,
              xrun: false
            };
          } else if (content.includes('state: XRUN')) {
            return {
              running: false,
              card: c,
              hwPtr: 0,
              delayFrames: 0,
              bufferPercent: 0,
              bufferMs: 0,
              xrun: true
            };
          }
        }
      }
    }
  } catch (e) {}
  return { running: false, card: null, hwPtr: 0, delayFrames: 0, bufferPercent: 0, bufferMs: 0, xrun: false };
}

// Track key and monotonic progression state
let lastTrackKey = '';
let trackPlaybackStartTime = 0;
let lastKnownValidPositionMs = 0;
let lastPositionClockTime = 0;

// Helper: populate metadata fields into state.playback from D-Bus meta object
function fillMetadata(meta, allProps, now, lengthMs, resolveArtworkPath, extractPaletteFromImage) {
  state.playback.album = meta['xesam:album'] || '';

  if (Array.isArray(meta['xesam:artist'])) {
    state.playback.artist = meta['xesam:artist'].join(', ');
  } else if (meta['xesam:artist']) {
    state.playback.artist = String(meta['xesam:artist']);
  } else {
    state.playback.artist = '';
  }

  if (Array.isArray(meta['xesam:composer'])) {
    state.playback.composer = meta['xesam:composer'].join(', ');
  } else if (meta['xesam:composer']) {
    state.playback.composer = String(meta['xesam:composer']);
  } else {
    state.playback.composer = '';
  }

  if (Array.isArray(meta['xesam:genre'])) {
    state.playback.genre = meta['xesam:genre'].join(', ');
  } else if (meta['xesam:genre']) {
    state.playback.genre = String(meta['xesam:genre']);
  } else {
    state.playback.genre = '';
  }

  state.playback.trackNumber = meta['xesam:trackNumber'] || null;
  state.playback.durationMs = lengthMs;
  state.playback.positionUpdatedAt = now;
  state.playback.volume = typeof allProps.Volume === 'number' ? +(allProps.Volume).toFixed(2) : null;

  const rawArtUrl = meta['mpris:artUrl'];
  const resolvedPath = resolveArtworkPath(rawArtUrl);
  if (resolvedPath) {
    const filename = path.basename(resolvedPath);
    state.playback.artworkUrl = `/api/artwork/${filename}`;
    state.playback.artworkFile = filename;
    state.playback.hasArtwork = true;
    state.playback.colors = extractPaletteFromImage(resolvedPath);
  } else {
    state.playback.artworkUrl = null;
    state.playback.artworkFile = null;
    state.playback.hasArtwork = false;
    state.playback.colors = null;
  }
}

async function pollMetadata() {
  if (!dbusBus) return;

  const alsaStatus = getAlsaHardwareStatus();
  state.receiver.alsaRunning = alsaStatus.running;
  state.receiver.alsaHwPtr = alsaStatus.hwPtr;
  state.receiver.alsaDelayFrames = alsaStatus.delayFrames;
  state.receiver.alsaBufferPercent = alsaStatus.bufferPercent;
  state.receiver.alsaBufferMs = alsaStatus.bufferMs;
  state.receiver.alsaXrun = alsaStatus.xrun;

  try {
    // 1. Shairport Sync base properties
    let spsIsActive = false;
    if (spsBaseProps) {
      const spsBase = unwrap(await spsBaseProps.GetAll('org.gnome.ShairportSync'));
      if (spsBase) {
        spsIsActive = !!spsBase.Active;
        state.receiver.active = spsIsActive;
        state.receiver.protocol = spsBase.Protocol || 'AirPlay 2';
        state.receiver.serviceName = spsBase.ServiceName || 'AirPlay';
        state.receiver.sourceFormat = spsBase.SourceFormat || '';
        state.receiver.outputFormat = spsBase.OutputFormat || '';
        state.receiver.version = spsBase.Version || '';
        state.receiver.versionString = spsBase.VersionString || '';
        state.receiver.driftTolerance = spsBase.DriftTolerance || 0.002;
        state.receiver.interpolation = spsBase.Interpolation || 'Vernier';
        state.receiver.alacDecoder = spsBase.ALACDecoder || 'FFmpeg';
        state.receiver.volumeControlProfile = spsBase.VolumeControlProfile || 'Standard';
        state.receiver.loudnessEnabled = !!spsBase.LoudnessEnabled;
        state.receiver.loudnessThreshold = spsBase.LoudnessThreshold || null;
        state.receiver.convolutionEnabled = !!spsBase.ConvolutionEnabled;
        state.receiver.firstFramePosition = spsBase.FirstFramePosition || '';
        state.receiver.framePosition = spsBase.FramePosition || '';
      }
    }

    // 2. MPRIS Player properties — POSITION COMES DIRECTLY FROM D-BUS
    if (mprisPlayerProps) {
      const allProps = unwrap(await mprisPlayerProps.GetAll('org.mpris.MediaPlayer2.Player'));
      if (allProps) {
        const mprisStatus = allProps.PlaybackStatus || 'Stopped';
        let rawPos = (typeof allProps.Position === 'bigint')
          ? Number(allProps.Position)
          : (typeof allProps.Position === 'number' ? allProps.Position : null);

        if (rawPos === null) {
          try {
            const posRaw = unwrap(await mprisPlayerProps.Get('org.mpris.MediaPlayer2.Player', 'Position'));
            rawPos = (typeof posRaw === 'bigint') ? Number(posRaw) : (typeof posRaw === 'number' ? posRaw : 0);
          } catch (e) {
            rawPos = 0;
          }
        }
        let dbusPositionMs = Math.round(rawPos / 1000);

        const meta = allProps.Metadata || {};
        const title = meta['xesam:title'] || '';
        let lengthMs = (typeof meta['mpris:length'] === 'bigint')
          ? Math.round(Number(meta['mpris:length']) / 1000)
          : (typeof meta['mpris:length'] === 'number' ? Math.round(meta['mpris:length'] / 1000) : 0);

        // Fallback for duration and position from ShairportSync.Client.NowPlayingInformation if needed
        if (spsBaseProps && (lengthMs === 0 || dbusPositionMs === 0)) {
          try {
            const npiRaw = await spsBaseProps.Get('org.gnome.ShairportSync.Client', 'NowPlayingInformation');
            const npi = unwrap(npiRaw);
            if (npi) {
              if (lengthMs === 0 && typeof npi.kMRMediaRemoteNowPlayingInfoDuration === 'number' && npi.kMRMediaRemoteNowPlayingInfoDuration > 0) {
                lengthMs = Math.round(npi.kMRMediaRemoteNowPlayingInfoDuration * 1000);
              }
              if (dbusPositionMs === 0 && typeof npi.kMRMediaRemoteNowPlayingInfoElapsedTime === 'number' && npi.kMRMediaRemoteNowPlayingInfoElapsedTime > 0) {
                dbusPositionMs = Math.round(npi.kMRMediaRemoteNowPlayingInfoElapsedTime * 1000);
              }
            }
          } catch (e) {}
        }

        const now = Date.now();
        const normTitle = (title || '').trim().toLowerCase();
        const normAlbum = (meta['xesam:album'] || '').trim().toLowerCase();
        const currentTrackKey = normTitle ? `${normTitle}:::${normAlbum}` : '';

        if ((mprisStatus === 'Playing' || mprisStatus === 'Paused') && title) {
          wakeDisplayIfNeeded(mprisStatus === 'Playing');

          if (currentTrackKey !== lastTrackKey || !lastTrackKey) {
            // New track detected
            lastTrackKey = currentTrackKey;
            trackPlaybackStartTime = now;
            lastKnownValidPositionMs = (dbusPositionMs > 0) ? dbusPositionMs : 0;
            lastPositionClockTime = now;
          } else if (mprisStatus === 'Playing') {
            const clockElapsed = Math.max(0, now - (lastPositionClockTime || now));

            if (dbusPositionMs > 1000) {
              if (dbusPositionMs < lastKnownValidPositionMs - 3000) {
                // Legitimate user scrub backwards to an earlier point in the song
                lastKnownValidPositionMs = dbusPositionMs;
              } else if (dbusPositionMs >= lastKnownValidPositionMs - 1500) {
                // Normal advancing D-Bus position
                lastKnownValidPositionMs = dbusPositionMs;
              } else {
                // Minor negative jitter (< 1.5s): smoothly interpolate forward
                lastKnownValidPositionMs += clockElapsed;
              }
            } else {
              // dbusPositionMs is 0 or <= 1000ms
              if (lastKnownValidPositionMs > 2000) {
                // ANOMALOUS ZERO DROP from D-Bus/Shairport Sync:
                // NEVER reset to zero! Advance smoothly with wall-clock time.
                lastKnownValidPositionMs += clockElapsed;
              } else {
                // Track is within its first 2 seconds
                if (dbusPositionMs > 0) {
                  lastKnownValidPositionMs = dbusPositionMs;
                } else {
                  lastKnownValidPositionMs = Math.max(0, now - trackPlaybackStartTime);
                }
              }
            }
            lastPositionClockTime = now;
          } else {
            // Paused: hold position steady
            lastPositionClockTime = now;
            if (dbusPositionMs > 0) {
              lastKnownValidPositionMs = dbusPositionMs;
            }
          }

          if (lengthMs > 0) {
            lastKnownValidPositionMs = Math.min(lengthMs, Math.max(0, lastKnownValidPositionMs));
          } else {
            lastKnownValidPositionMs = Math.max(0, lastKnownValidPositionMs);
          }

          const positionMs = Math.round(lastKnownValidPositionMs);

          state.playback.status = mprisStatus;
          state.playback.title = title;
          state.playback.positionMs = positionMs;

          fillMetadata(meta, allProps, now, lengthMs, resolveArtworkPath, extractPaletteFromImage);

        } else {
          wakeDisplayIfNeeded(false);
          lastTrackKey = '';
          trackPlaybackStartTime = 0;
          lastKnownValidPositionMs = 0;
          lastPositionClockTime = now;

          state.playback.status = 'Stopped';
          state.playback.title = '';
          state.playback.artist = '';
          state.playback.album = '';
          state.playback.genre = '';
          state.playback.composer = '';
          state.playback.trackNumber = null;
          state.playback.durationMs = 0;
          state.playback.positionMs = 0;
          state.playback.positionUpdatedAt = now;
          state.playback.artworkUrl = null;
          state.playback.artworkFile = null;
          state.playback.hasArtwork = false;
          state.playback.colors = null;
        }
      }
    }

    // 3. Shairport Sync remote control properties
    if (spsRemoteProps) {
      const spsRemote = unwrap(await spsRemoteProps.GetAll('org.gnome.ShairportSync.RemoteControl'));
      if (spsRemote) {
        state.receiver.clientIp = spsRemote.Client || '';
        state.receiver.clientName = spsRemote.ClientName || '';
        state.receiver.streamType = spsRemote.StreamType || '';
        if (typeof spsRemote.AirplayVolume === 'number') {
          state.playback.airplayVolumeDb = +spsRemote.AirplayVolume.toFixed(1);
        }
      }
    }
  } catch (err) {}

  updateSystemMetrics();
}

async function initDBus() {
  try {
    if (!dbusBus) {
      dbusBus = dbus.systemBus();
    }

    // Setup MPRIS proxy
    try {
      const mprisObj = await dbusBus.getProxyObject('org.mpris.MediaPlayer2.ShairportSync', '/org/mpris/MediaPlayer2');
      mprisPlayerProps = mprisObj.getInterface('org.freedesktop.DBus.Properties');
      mprisPlayerProps.on('PropertiesChanged', async () => {
        await pollMetadata();
        broadcastState();
      });
    } catch (e) {}

    // Setup ShairportSync proxy
    try {
      const spsObj = await dbusBus.getProxyObject('org.gnome.ShairportSync', '/org/gnome/ShairportSync');
      spsBaseProps = spsObj.getInterface('org.freedesktop.DBus.Properties');
      spsRemoteProps = spsBaseProps;
      spsBaseProps.on('PropertiesChanged', async () => {
        await pollMetadata();
        broadcastState();
      });
    } catch (e) {}

    await pollMetadata();
    broadcastState();
  } catch (err) {
    console.error('D-Bus init error:', err.message);
  }
}

// Adaptive periodic check: 250ms during active playback for zero-lag detection, 1000ms while idle
let pollTimer = null;
async function pollLoop() {
  try {
    if (!mprisPlayerProps || !spsBaseProps) {
      await initDBus();
    }
    await pollMetadata();
    broadcastState();
  } catch (e) {}

  const nextInterval = (state.playback && state.playback.status === 'Playing') ? 250 : 1000;
  pollTimer = setTimeout(pollLoop, nextInterval);
}
pollLoop();

// Watch coverart directory directly
try {
  if (fs.existsSync(COVERART_DIR)) {
    fs.watch(COVERART_DIR, async () => {
      await pollMetadata();
      broadcastState();
    });
  }
} catch (e) {}

// API: Current status JSON
app.get('/api/status', (req, res) => {
  res.json({ success: true, data: state });
});

// API: Server-Sent Events (SSE)
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'init', data: state })}\n\n`);
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    hostname: os.hostname(),
    shairportActive: state.receiver.active
  });
});

// API: Artwork by filename
app.get('/api/artwork/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^cover-[a-zA-Z0-9_-]+\.(jpg|jpeg|png)$/i.test(filename)) {
    return res.status(400).send('Invalid filename');
  }

  const filePath = path.resolve(COVERART_DIR, filename);
  const normalizedCoverDir = path.resolve(COVERART_DIR);

  if (!filePath.startsWith(normalizedCoverDir + path.sep)) {
    return res.status(403).send('Forbidden');
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).set('Content-Type', 'image/svg+xml').send(PLACEHOLDER_SVG);
  }

  const stat = fs.statSync(filePath);
  res.set({
    'Content-Type': 'image/jpeg',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=86400, immutable',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

// API: Dynamic current artwork
app.get('/api/artwork', (req, res) => {
  if (state.playback.artworkFile) {
    const filePath = path.resolve(COVERART_DIR, state.playback.artworkFile);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  res.set({
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  }).send(PLACEHOLDER_SVG);
});

// WebSocket connection handling & Ping/Pong
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', data: state }));
  ws.on('message', (message) => {
    try {
      const text = (typeof message === 'string') ? message : message.toString('utf8');
      const msg = JSON.parse(text);
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', clientTime: msg.time, serverTime: Date.now() }));
      }
    } catch (e) {}
  });
});

// ========================================================
// API: Raspberry Pi Desktop & Window Controls (Minimize / Fullscreen / Close)
// ========================================================
// EXEC_ENV defined at top of file

// Security Middleware: restrict hardware window management endpoints to local host only
function requireLocalAccess(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.includes('localhost');
  if (!isLocal) {
    return res.status(403).json({ error: 'Access denied: window management permitted from localhost only' });
  }
  next();
}

app.use('/api/system/window', requireLocalAccess);

// Minimize window to Raspberry Pi desktop
app.post('/api/system/window/minimize', (req, res) => {
  const cmd = 'DISPLAY=:0 xdotool search --onlyvisible --class chromium windowminimize 2>/dev/null || (XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 wlrctl toplevel minimize 2>/dev/null)';
  child_process.exec(cmd, { env: EXEC_ENV }, (err, stdout, stderr) => {
    res.json({ success: true, action: 'minimized' });
  });
});

// Toggle fullscreen state
app.post('/api/system/window/fullscreen', (req, res) => {
  const cmd = 'DISPLAY=:0 xdotool search --onlyvisible --class chromium key --window %1 F11 2>/dev/null || (XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 wlrctl toplevel fullscreen 2>/dev/null)';
  child_process.exec(cmd, { env: EXEC_ENV }, (err, stdout, stderr) => {
    res.json({ success: true, action: 'fullscreen_toggled' });
  });
});

// Restore / activate window from taskbar
app.post('/api/system/window/restore', (req, res) => {
  const cmd = 'DISPLAY=:0 xdotool search --class chromium windowactivate 2>/dev/null || (XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 wlrctl toplevel focus 2>/dev/null)';
  child_process.exec(cmd, { env: EXEC_ENV }, (err, stdout, stderr) => {
    res.json({ success: true, action: 'restored' });
  });
});

// Close / stop the dashboard browser display
app.post('/api/system/window/close', (req, res) => {
  child_process.exec('touch /tmp/airplay-dashboard-intentional-quit && pkill -f "airplay-dashboard-chrome-profile"', { env: EXEC_ENV }, (err, stdout, stderr) => {
    res.json({ success: true, action: 'closed' });
  });
});

// Restart the dashboard display launcher
app.post('/api/system/window/relaunch', (req, res) => {
  child_process.exec('rm -f /tmp/airplay-dashboard-intentional-quit; /opt/airplay-dashboard/launch-display.sh >/tmp/airplay-dashboard-display.log 2>&1 &', { env: EXEC_ENV }, (err, stdout, stderr) => {
    res.json({ success: true, action: 'relaunched' });
  });
});

// Broadcast reload to all connected frontend clients
app.post('/api/system/window/reload', (req, res) => {
  const payload = JSON.stringify({ type: 'reload' });
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      try { client.send(payload); } catch (e) {}
    }
  }
  const sseMsg = `data: ${payload}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(sseMsg); } catch (e) { sseClients.splice(i, 1); }
  }
  res.json({ success: true, action: 'reloaded' });
});

// Broadcast tab switch to all connected frontend clients
app.post('/api/system/tab/:tabId', (req, res) => {
  const payload = JSON.stringify({ type: 'switchTab', tab: req.params.tabId });
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      try { client.send(payload); } catch (e) {}
    }
  }
  res.json({ success: true, tab: req.params.tabId });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Network Keep-Alive Heartbeat (prevents Wi-Fi router IGMP multicast tables from expiring after long idle)
setInterval(() => {
  child_process.exec('ping -c 1 -W 1 44.44.44.1 >/dev/null 2>&1', () => {});
}, 60000);

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`AirPlay Dashboard listening on http://0.0.0.0:${PORT}`);
  initDBus();
});
