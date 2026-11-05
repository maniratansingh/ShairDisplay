// ========================================================
// AirPlay 2 100% Real-Time Music & Diagnostics Engine
// WITH ARTWORK-MATCHED AMBIENT COLOR EXTRACTION
// OPTIMIZED FOR 22-INCH (1080p) MONITORS
// ========================================================

(function () {
  'use strict';

  // Navigation Tab Elements
  const tabBtnNowPlaying = document.getElementById('tab-btn-now-playing');
  const tabBtnDiagnostics = document.getElementById('tab-btn-diagnostics');
  const viewNowPlaying = document.getElementById('view-now-playing');
  const viewDiagnostics = document.getElementById('view-diagnostics');

  // Header Elements
  const elAmbientBackdrop = document.getElementById('ambient-backdrop');
  const elProtocolPill = document.getElementById('protocol-pill');
  const elStatusPulse = document.getElementById('status-pulse');
  const elStatusText = document.getElementById('status-text');

  // Tab 1 (Now Playing) Elements
  const elArtworkImgCurrent = document.getElementById('artwork-img-current');
  const elArtworkImgNext = document.getElementById('artwork-img-next');
  const elArtworkStandbyHero = document.getElementById('artwork-standby-hero');
  const elStandbyReceiverPill = document.getElementById('standby-receiver-pill');
  const elSongTitle = document.getElementById('song-title');
  const elSongArtist = document.getElementById('song-artist');
  const elSongAlbum = document.getElementById('song-album');
  const elGenreRow = document.getElementById('genre-row');
  const elBadgeGenre = document.getElementById('badge-genre');
  const elBadgeTrackNum = document.getElementById('badge-track-num');
  const elBadgeCodec = document.getElementById('badge-codec');

  const elAudioSeekingPanel = document.getElementById('audio-seeking-panel');
  const elProgressBarContainer = document.getElementById('progress-bar-container');
  const elProgressFill = document.getElementById('progress-fill');
  const elProgressKnob = document.getElementById('progress-knob');
  const elTimeElapsed = document.getElementById('time-elapsed');
  const elTimeDuration = document.getElementById('time-duration');
  const elSeekHintToast = document.getElementById('seek-hint-toast');
  const elPillVolume = document.getElementById('pill-volume');
  const elPillStreamFormat = document.getElementById('pill-stream-format');

  // Tab 2: Vintage Analogue VU Meters Elements
  const elNeedleLeft = document.getElementById('needle-group-left');
  const elNeedleRight = document.getElementById('needle-group-right');
  const elPeakLampLeft = document.getElementById('peak-lamp-left');
  const elPeakLampRight = document.getElementById('peak-lamp-right');

  const elMeterDacFormat = document.getElementById('meter-dac-format');
  const elMeterBufferDepth = document.getElementById('meter-buffer-depth');
  const elMeterDbAttenuation = document.getElementById('meter-db-attenuation');
  const elMeterFrameClock = document.getElementById('meter-frame-clock');

  // Tab 2: Oscilloscope & Sync Elements
  const elOscGlowPath = document.getElementById('osc-glow-path');
  const elOscCorePath = document.getElementById('osc-core-path');
  const elOscHeadDot = document.getElementById('osc-head-dot');
  const elSyncPtpBadge = document.getElementById('sync-ptp-badge');
  const elSyncDriftBadge = document.getElementById('sync-drift-badge');
  const elSyncShmVal = document.getElementById('sync-shm-val');
  const elSyncDriftVal = document.getElementById('sync-drift-val');
  const elSyncInterpVal = document.getElementById('sync-interp-val');
  const elSyncBufferVal = document.getElementById('sync-buffer-val');
  const elSyncTicksVal = document.getElementById('sync-ticks-val');

  // Tab 2: Bottom Cards Elements
  const elPipeCodec = document.getElementById('pipe-codec');
  const elPipeDecoder = document.getElementById('pipe-decoder');
  const elPipeAlsa = document.getElementById('pipe-alsa');
  const elPipeClient = document.getElementById('pipe-client');
  const elPipeSyncMode = document.getElementById('pipe-sync-mode');
  const elPipeWsPing = document.getElementById('pipe-ws-ping');

  const elChartCpu = document.getElementById('chart-cpu');
  const elChartTemp = document.getElementById('chart-temp');
  const elChartMem = document.getElementById('chart-mem');
  const elChartCpuVal = document.getElementById('chart-cpu-val');
  const elChartTempVal = document.getElementById('chart-temp-val');
  const elChartMemVal = document.getElementById('chart-mem-val');
  const elHwHost = document.getElementById('hw-host');
  const elHwUptime = document.getElementById('hw-uptime');
  const elHwKernel = document.getElementById('hw-kernel');

  // State Containers
  let currentArtworkUrl = '';
  let playbackData = null;
  let receiverData = null;
  let systemData = null;
  let animFrameId = null;
  let syncTickCount = 0;
  let lastPingSend = 0;
  let wsLatencyMs = null;

  // Real Hardware Rolling History (30 points)
  const MAX_HISTORY = 30;
  const cpuHistory = [];
  const tempHistory = [];
  const memHistory = [];

  // Real PTP Clock Jitter History (60 points for Oscilloscope)
  const MAX_OSC_POINTS = 60;
  const ptpJitterHistory = [];

  // ========================================================
  // Tab Switching
  // ========================================================
  function switchTab(tabId) {
    if (tabId === 'now-playing') {
      tabBtnNowPlaying.classList.add('active');
      tabBtnDiagnostics.classList.remove('active');
      viewNowPlaying.classList.add('active');
      viewDiagnostics.classList.remove('active');
    } else {
      tabBtnDiagnostics.classList.add('active');
      tabBtnNowPlaying.classList.remove('active');
      viewDiagnostics.classList.add('active');
      viewNowPlaying.classList.remove('active');
    }
  }

  tabBtnNowPlaying.addEventListener('click', () => switchTab('now-playing'));
  tabBtnDiagnostics.addEventListener('click', () => switchTab('diagnostics'));

  // ========================================================
  // Helpers
  // ========================================================
  function formatTime(ms) {
    if (!ms || ms < 0 || isNaN(ms)) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  function formatUptime(sec) {
    if (!sec) return '--';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ========================================================
  // DYNAMIC ARTWORK COLOR EXTRACTION ENGINE
  // EXTRACTS PALETTE FROM ACTUAL JPEG PIXELS
  // ========================================================
  function extractPalette(img) {
    try {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;

      let bestR = 250, bestG = 45, bestB = 85;
      let maxScore = -1;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const brightness = (r + g + b) / 3;

        // Favor saturated, non-black, non-white colors
        if (brightness > 35 && brightness < 225 && delta > 20) {
          const score = delta * 1.5 + brightness * 0.5;
          if (score > maxScore) {
            maxScore = score;
            bestR = r; bestG = g; bestB = b;
          }
        }
      }

      const primary = `rgb(${bestR}, ${bestG}, ${bestB})`;
      const ambient = `rgba(${bestR}, ${bestG}, ${bestB}, 0.45)`;
      const glow = `rgba(${bestR}, ${bestG}, ${bestB}, 0.65)`;

      // Apply dynamically to document root
      document.documentElement.style.setProperty('--artwork-primary', primary);
      document.documentElement.style.setProperty('--artwork-ambient', ambient);
      document.documentElement.style.setProperty('--artwork-glow', glow);
    } catch (e) {
      // Safe fallback
      document.documentElement.style.setProperty('--artwork-primary', '#fa2d55');
      document.documentElement.style.setProperty('--artwork-ambient', 'rgba(250, 45, 85, 0.45)');
      document.documentElement.style.setProperty('--artwork-glow', 'rgba(250, 45, 85, 0.65)');
    }
  }

  // Reset ambient colors to deep dark mode
  function resetPalette() {
    document.documentElement.style.setProperty('--artwork-primary', '#fa2d55');
    document.documentElement.style.setProperty('--artwork-ambient', 'rgba(255, 255, 255, 0.04)');
    document.documentElement.style.setProperty('--artwork-glow', 'rgba(255, 255, 255, 0.08)');
    if (elAmbientBackdrop) elAmbientBackdrop.style.backgroundImage = 'none';
  }

  // ========================================================
  // Artwork Cross-Fade & Standby Mode Transition
  // ========================================================
  function updateArtwork(newUrl) {
    if (!newUrl) {
      currentArtworkUrl = '';
      if (elArtworkStandbyHero) elArtworkStandbyHero.classList.add('active');
      if (elArtworkImgCurrent) elArtworkImgCurrent.classList.remove('active');
      if (elArtworkImgNext) elArtworkImgNext.classList.remove('active');
      resetPalette();
      return;
    }

    if (currentArtworkUrl === newUrl) return;
    currentArtworkUrl = newUrl;

    const imgCurrent = elArtworkImgCurrent.classList.contains('active') ? elArtworkImgCurrent : elArtworkImgNext;
    const imgNext = imgCurrent === elArtworkImgCurrent ? elArtworkImgNext : elArtworkImgCurrent;

    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';
    tempImg.onload = () => {
      // Extract vibrant colors from the real artwork JPEG
      extractPalette(tempImg);

      imgNext.src = newUrl;
      imgNext.classList.add('active');
      imgCurrent.classList.remove('active');
      if (elArtworkStandbyHero) elArtworkStandbyHero.classList.remove('active');
      if (elAmbientBackdrop) elAmbientBackdrop.style.backgroundImage = `url("${newUrl}")`;
    };
    tempImg.onerror = () => {
      if (elArtworkStandbyHero) elArtworkStandbyHero.classList.add('active');
      imgCurrent.classList.remove('active');
      imgNext.classList.remove('active');
      resetPalette();
    };
    tempImg.src = newUrl;
  }

  // ========================================================
  // Real-Time Audio Progress & Strict Song Completion Halt
  // ZERO RUNAWAY BAR • ZERO FAKE PROGRESS • STOPS THEN AND THERE
  // ========================================================
  function resetProgressUI() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (elAudioSeekingPanel) {
      elAudioSeekingPanel.classList.add('stopped');
      elAudioSeekingPanel.classList.remove('playing');
    }
    elProgressFill.style.width = '0%';
    elProgressKnob.style.left = '0%';
    elTimeElapsed.textContent = '0:00';
    elTimeDuration.textContent = '0:00';
    if (elMeterFrameClock) elMeterFrameClock.textContent = '0 frames';
  }

  function renderStandbyUI() {
    elStatusText.textContent = (receiverData && receiverData.active) ? 'Ready' : 'Standby';
    elStatusPulse.className = 'status-pulse-dot stopped';

    // Completely empty and clear the finished song information
    elSongTitle.textContent = 'AirPlay 2';
    elSongArtist.textContent = (receiverData && receiverData.active) ? 'Ready to Stream' : 'AirPlay Standby';
    elSongAlbum.textContent = 'Select this speaker in Control Center on your Apple device';

    if (elGenreRow) elGenreRow.style.display = 'none';
    if (elBadgeGenre) elBadgeGenre.style.display = 'none';
    if (elBadgeTrackNum) elBadgeTrackNum.style.display = 'none';
    if (elBadgeCodec) elBadgeCodec.style.display = 'none';

    if (elStandbyReceiverPill) {
      elStandbyReceiverPill.textContent = (receiverData && receiverData.active) ? 'Ready to Stream' : 'AirPlay Standby';
    }

    updateArtwork(null);
  }

  function clearFinishedSong() {
    if (playbackData) {
      playbackData.status = 'Stopped';
      playbackData.title = '';
      playbackData.artist = '';
      playbackData.album = '';
      playbackData.genre = '';
      playbackData.composer = '';
      playbackData.trackNumber = null;
      playbackData.durationMs = 0;
      playbackData.positionMs = 0;
      playbackData.artworkUrl = null;
      playbackData.hasArtwork = false;
    }
    resetProgressUI();
    renderStandbyUI();
  }

  let clientPositionAnchorMs = 0;
  let clientPositionAnchorTime = 0;

  function updateProgress() {
    if (playbackData && playbackData.status === 'Playing' && playbackData.durationMs > 0) {
      const nowPerf = performance.now();
      const elapsed = Math.max(0, nowPerf - (clientPositionAnchorTime || nowPerf));
      // D-Bus Position is the single source of truth; interpolate forward at 1x speed
      const currentPosition = Math.min(playbackData.durationMs, clientPositionAnchorMs + elapsed);
      const percent = Math.min(100, Math.max(0, (currentPosition / playbackData.durationMs) * 100));

      if (elAudioSeekingPanel) {
        elAudioSeekingPanel.classList.remove('stopped');
        elAudioSeekingPanel.classList.add('playing');
      }
      elProgressFill.style.width = `${percent.toFixed(2)}%`;
      elProgressKnob.style.left = `${percent.toFixed(2)}%`;
      elTimeElapsed.textContent = formatTime(currentPosition);
      elTimeDuration.textContent = formatTime(playbackData.durationMs);

      // Frame Clock: Hardware sample count
      if (elMeterFrameClock && receiverData && receiverData.alsaRunning) {
        if (receiverData.alsaHwPtr) {
          elMeterFrameClock.textContent = `${receiverData.alsaHwPtr.toLocaleString()} hw frames`;
        }
      }

      animFrameId = requestAnimationFrame(updateProgress);
    } else if (playbackData && playbackData.status === 'Paused' && playbackData.durationMs > 0) {
      // While paused: show exact D-Bus position, no interpolation
      const currentPosition = Math.min(playbackData.durationMs, Math.max(0, playbackData.positionMs || 0));
      const percent = Math.min(100, Math.max(0, (currentPosition / playbackData.durationMs) * 100));

      if (elAudioSeekingPanel) {
        elAudioSeekingPanel.classList.remove('stopped');
        elAudioSeekingPanel.classList.add('playing');
      }
      elProgressFill.style.width = `${percent.toFixed(2)}%`;
      elProgressKnob.style.left = `${percent.toFixed(2)}%`;
      elTimeElapsed.textContent = formatTime(currentPosition);
      elTimeDuration.textContent = formatTime(playbackData.durationMs);
    } else {
      resetProgressUI();
    }
  }

  // Click feedback on seeking panel
  let seekToastTimer = null;
  if (elProgressBarContainer && elSeekHintToast) {
    elProgressBarContainer.addEventListener('click', () => {
      elSeekHintToast.classList.add('active');
      if (seekToastTimer) clearTimeout(seekToastTimer);
      seekToastTimer = setTimeout(() => {
        elSeekHintToast.classList.remove('active');
      }, 2500);
    });
  }

  // ========================================================
  // VINTAGE ANALOGUE METERS (100% REAL HARDWARE MEASUREMENTS)
  // METER 1: Genuine AirPlay Audio Attenuation (-20 dB to +3 dB)
  // METER 2: Real ALSA DAC Ring-Buffer Depth (%) & DMA Latency (ms)
  // ACCUPHASE / MARANTZ / MCINTOSH LUXURY AUDIOPHILE DIALS
  // ZERO SIMULATION • ZERO FAKE BOUNCE • INDEPENDENT REAL SENSORS
  // ========================================================
  function dbToNeedleDegrees(db) {
    if (db <= -20) return -41.8;
    if (db >= 3) return 39.0;
    if (db <= 0) {
      return -41.8 + ((db + 20) / 20) * (16.0 - (-41.8));
    } else {
      return 16.0 + (db / 3) * (39.0 - 16.0);
    }
  }

  function percentToBufferDegrees(pct) {
    if (pct <= 0) return -41.8;
    if (pct >= 100) return 39.0;
    return -41.8 + (pct / 100) * (39.0 - (-41.8));
  }

  const needleState = {
    leftDeg: -41.8,
    leftTarget: -41.8,
    leftVel: 0,
    rightDeg: -41.8,
    rightTarget: -41.8,
    rightVel: 0
  };

  function updateVUMetersPhysics() {
    const isPlaying = playbackData && playbackData.status === 'Playing';

    // Left Meter: True AirPlay Volume Attenuation (dB)
    if (isPlaying) {
      let realDb = -20;
      if (playbackData.airplayVolumeDb !== null && playbackData.airplayVolumeDb !== undefined) {
        realDb = playbackData.airplayVolumeDb;
      } else if (playbackData.volume !== null && playbackData.volume !== undefined) {
        realDb = playbackData.volume > 0 ? (20 * Math.log10(playbackData.volume)) : -20;
      }
      needleState.leftTarget = dbToNeedleDegrees(realDb);
    } else {
      needleState.leftTarget = -41.8;
    }

    // Right Meter: Real ALSA DAC Ring-Buffer Depth (%) from /proc/asound
    if (isPlaying && receiverData && receiverData.alsaRunning) {
      const bufferPct = (receiverData.alsaBufferPercent !== undefined && receiverData.alsaBufferPercent !== null) 
        ? receiverData.alsaBufferPercent 
        : 0;
      needleState.rightTarget = percentToBufferDegrees(bufferPct);
    } else {
      needleState.rightTarget = -41.8;
    }

    const spring = 0.14;
    const damping = 0.72;

    // Independent Left needle spring physics
    const accelLeft = (needleState.leftTarget - needleState.leftDeg) * spring;
    needleState.leftVel = (needleState.leftVel + accelLeft) * damping;
    needleState.leftDeg += needleState.leftVel;

    // Independent Right needle spring physics
    const accelRight = (needleState.rightTarget - needleState.rightDeg) * spring;
    needleState.rightVel = (needleState.rightVel + accelRight) * damping;
    needleState.rightDeg += needleState.rightVel;

    if (elNeedleLeft) {
      elNeedleLeft.style.transform = `rotate(${needleState.leftDeg.toFixed(2)}deg)`;
    }
    if (elNeedleRight) {
      elNeedleRight.style.transform = `rotate(${needleState.rightDeg.toFixed(2)}deg)`;
    }

    // Left Peak LED: Real AirPlay 0 dB full scale
    if (elPeakLampLeft) {
      if (needleState.leftDeg >= 16.0) {
        elPeakLampLeft.classList.add('active');
      } else {
        elPeakLampLeft.classList.remove('active');
      }
    }

    // Right Peak LED: Real ALSA Hardware XRUN / Buffer Starvation Alert
    if (elPeakLampRight) {
      const hasXrun = receiverData && receiverData.alsaXrun;
      const isStarving = receiverData && receiverData.alsaRunning && receiverData.alsaBufferPercent < 2;
      if (hasXrun || isStarving) {
        elPeakLampRight.classList.add('active');
      } else {
        elPeakLampRight.classList.remove('active');
      }
    }

    requestAnimationFrame(updateVUMetersPhysics);
  }
  requestAnimationFrame(updateVUMetersPhysics);

  // ========================================================
  // REAL NQPTP CLOCK JITTER OSCILLOSCOPE (LABORATORY CRT CRT)
  // ZERO SIMULATION • 100% REAL SHARED MEMORY TELEMETRY
  // ========================================================
  function renderOscilloscope() {
    if (!elOscGlowPath || !elOscCorePath) return;

    if (ptpJitterHistory.length > 1) {
      const maxJitterUs = 500;
      const w = 1200, midY = 70;
      const step = w / (MAX_OSC_POINTS - 1);
      const offset = (MAX_OSC_POINTS - ptpJitterHistory.length) * step;

      let d = '';
      for (let i = 0; i < ptpJitterHistory.length; i++) {
        const x = offset + i * step;
        const normalized = Math.max(-1, Math.min(1, ptpJitterHistory[i] / maxJitterUs));
        const y = midY - normalized * 58;
        if (i === 0) d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        else d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }

      elOscGlowPath.setAttribute('d', d);
      elOscCorePath.setAttribute('d', d);

      const lastX = offset + (ptpJitterHistory.length - 1) * step;
      const lastNorm = Math.max(-1, Math.min(1, ptpJitterHistory[ptpJitterHistory.length - 1] / maxJitterUs));
      const lastY = midY - lastNorm * 58;
      if (elOscHeadDot) {
        elOscHeadDot.setAttribute('cx', lastX.toFixed(1));
        elOscHeadDot.setAttribute('cy', lastY.toFixed(1));
        elOscHeadDot.style.display = 'block';
      }
    } else {
      elOscGlowPath.setAttribute('d', 'M 0 70 L 1200 70');
      elOscCorePath.setAttribute('d', 'M 0 70 L 1200 70');
      if (elOscHeadDot) elOscHeadDot.style.display = 'none';
    }

    requestAnimationFrame(renderOscilloscope);
  }
  requestAnimationFrame(renderOscilloscope);

  // ========================================================
  // SVG Sparkline Chart Renderer
  // ========================================================
  function updateSparklineSVG(lineId, areaId, data, minVal, maxVal) {
    const lineEl = document.getElementById(lineId);
    const areaEl = document.getElementById(areaId);
    if (!lineEl || !areaEl || !data || data.length < 2) return;

    const w = 280, h = 44;
    const min = minVal !== undefined ? minVal : Math.min(...data);
    const max = maxVal !== undefined ? maxVal : Math.max(...data, min + 0.1);
    const range = (max - min) || 1;
    const step = w / (MAX_HISTORY - 1);
    const offset = (MAX_HISTORY - data.length) * step;

    let lineD = '';
    for (let i = 0; i < data.length; i++) {
      const x = offset + i * step;
      const y = h - ((data[i] - min) / range) * (h - 8) - 4;
      if (i === 0) lineD += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      else lineD += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }

    lineEl.setAttribute('d', lineD);
    const lastX = offset + (data.length - 1) * step;
    const areaD = `${lineD} L ${lastX.toFixed(1)} ${h} L ${offset.toFixed(1)} ${h} Z`;
    areaEl.setAttribute('d', areaD);
  }

  // ========================================================
  // Main State Render Loop
  // ========================================================
  function render(state) {
    if (!state) return;
    syncTickCount++;

    playbackData = state.playback || {};
    receiverData = state.receiver || {};
    systemData = state.system || {};

    // Monotonic client-side anchor for smooth, drift-free 60fps interpolation
    clientPositionAnchorMs = playbackData.positionMs || 0;
    clientPositionAnchorTime = performance.now();

    // 1. Header & Badges
    const status = playbackData.status || 'Stopped';
    elStatusText.textContent = status;
    elStatusPulse.className = 'status-pulse-dot';
    if (status === 'Playing') {
      elStatusPulse.classList.add('playing');
    } else if (status === 'Paused') {
      elStatusPulse.classList.add('paused');
    } else {
      elStatusPulse.classList.add('stopped');
    }

    if (receiverData.protocol) {
      elProtocolPill.textContent = receiverData.protocol;
    }

    // 2. Tab 1: Hero Music Details
    if (status !== 'Stopped' && playbackData.title) {
      elSongTitle.textContent = playbackData.title;
      elSongArtist.textContent = playbackData.artist || 'Unknown Artist';
      elSongAlbum.textContent = playbackData.album || '';
      
      let hasBadge = false;
      if (playbackData.genre) {
        elBadgeGenre.textContent = playbackData.genre;
        elBadgeGenre.style.display = 'inline-block';
        hasBadge = true;
      } else {
        elBadgeGenre.style.display = 'none';
      }

      if (playbackData.trackNumber) {
        elBadgeTrackNum.textContent = `Track ${playbackData.trackNumber}`;
        elBadgeTrackNum.style.display = 'inline-block';
        hasBadge = true;
      } else {
        elBadgeTrackNum.style.display = 'none';
      }

      if (receiverData.sourceFormat) {
        const fmt = receiverData.sourceFormat.split('/')[0] || 'AAC';
        elBadgeCodec.textContent = `${fmt} 48kHz`;
        elBadgeCodec.style.display = 'inline-block';
        hasBadge = true;
      } else {
        elBadgeCodec.style.display = 'none';
      }

      if (elGenreRow) elGenreRow.style.display = hasBadge ? 'flex' : 'none';

      updateArtwork(playbackData.artworkUrl);

      // Apply server-extracted vibrant palette from the real artwork JPEG
      if (playbackData.colors && playbackData.colors.primary) {
        document.documentElement.style.setProperty('--artwork-primary', playbackData.colors.primary);
        document.documentElement.style.setProperty('--artwork-ambient', playbackData.colors.ambient);
        document.documentElement.style.setProperty('--artwork-glow', playbackData.colors.glow);
      }
    } else {
      renderStandbyUI();
    }

    if (animFrameId) cancelAnimationFrame(animFrameId);
    updateProgress();

    // Volume Pill
    if (playbackData.airplayVolumeDb !== null && playbackData.airplayVolumeDb !== undefined) {
      const volPct = playbackData.volume !== null ? ` (${Math.round(playbackData.volume * 100)}%)` : '';
      elPillVolume.textContent = `AirPlay Vol: ${playbackData.airplayVolumeDb} dB${volPct}`;
    } else if (playbackData.volume !== null && playbackData.volume !== undefined) {
      elPillVolume.textContent = `Volume: ${Math.round(playbackData.volume * 100)}%`;
    } else {
      elPillVolume.textContent = 'Volume: Connected';
    }

    if (receiverData.sourceFormat) {
      const mode = receiverData.streamType ? `AirPlay 2 ${receiverData.streamType}` : 'AirPlay 2';
      elPillStreamFormat.textContent = `${receiverData.sourceFormat} • ${mode}`;
    } else {
      elPillStreamFormat.textContent = 'AirPlay 2 Standby';
    }

    // 3. Tab 2: Real Analogue Meter Sub-Bar Stats
    if (elMeterDbAttenuation) {
      if (playbackData.airplayVolumeDb !== null && playbackData.airplayVolumeDb !== undefined) {
        elMeterDbAttenuation.textContent = `${playbackData.airplayVolumeDb} dB (Exact Gain)`;
      } else {
        elMeterDbAttenuation.textContent = '-20.0 dB (Stop Pin)';
      }
    }
    if (elMeterBufferDepth) {
      if (receiverData.alsaBufferPercent !== undefined && receiverData.alsaRunning) {
        elMeterBufferDepth.textContent = `${receiverData.alsaBufferPercent}% (${receiverData.alsaBufferMs || 0} ms Latency)`;
      } else {
        elMeterBufferDepth.textContent = '0% (DAC Idle)';
      }
    }
    if (elMeterDacFormat) {
      elMeterDacFormat.textContent = receiverData.outputFormat ? `${receiverData.outputFormat} LPCM Stereo` : 'hw:Headphones (ALSA)';
    }
    if (elMeterFrameClock) {
      if (receiverData.alsaHwPtr && receiverData.alsaRunning) {
        elMeterFrameClock.textContent = `${receiverData.alsaHwPtr.toLocaleString()} hw frames`;
      } else {
        elMeterFrameClock.textContent = '0 frames (DAC Idle)';
      }
    }

    // 4. Tab 2: REAL PTP Sync & Oscilloscope Metrics
    if (receiverData.nqptpActive) {
      if (elSyncPtpBadge) elSyncPtpBadge.textContent = 'PTP Clock Locked';
      if (elSyncShmVal) {
        elSyncShmVal.textContent = receiverData.nqptpMasterClockId ? `Clock ID: ${receiverData.nqptpMasterClockId}` : '/dev/shm/nqptp Active';
      }

      const realJitter = receiverData.nqptpJitterUs !== undefined ? receiverData.nqptpJitterUs : 0;
      ptpJitterHistory.push(realJitter);
      if (ptpJitterHistory.length > MAX_OSC_POINTS) ptpJitterHistory.shift();

      if (elSyncDriftBadge) {
        elSyncDriftBadge.textContent = `Offset Jitter: ${realJitter} µs`;
      }
    } else {
      if (elSyncPtpBadge) elSyncPtpBadge.textContent = 'PTP Idle';
      if (elSyncShmVal) elSyncShmVal.textContent = 'Standby';
    }

    if (elSyncDriftVal) {
      elSyncDriftVal.textContent = receiverData.driftTolerance ? `${receiverData.driftTolerance} s (${(receiverData.driftTolerance * 1000).toFixed(1)} ms)` : '--';
    }
    if (elSyncInterpVal) {
      elSyncInterpVal.textContent = receiverData.interpolation ? `${receiverData.interpolation} Sub-sample Engine` : '--';
    }
    if (elSyncBufferVal) {
      elSyncBufferVal.textContent = receiverData.streamType ? `${receiverData.streamType} Audio Stream` : 'Standby';
    }
    if (elSyncTicksVal) {
      elSyncTicksVal.textContent = syncTickCount.toLocaleString();
    }

    // 5. Tab 2: Bottom Cards
    if (elPipeCodec) elPipeCodec.textContent = receiverData.sourceFormat || 'Standby';
    if (elPipeDecoder) elPipeDecoder.textContent = receiverData.alacDecoder ? `${receiverData.alacDecoder} Audio Engine` : 'Internal Decoder';
    if (elPipeAlsa) elPipeAlsa.textContent = receiverData.outputFormat ? `${receiverData.outputFormat} (${receiverData.alsaDevice || 'hw:Headphones'})` : (receiverData.alsaDevice || 'hw:Headphones');
    if (elPipeClient) elPipeClient.textContent = receiverData.clientIp || 'None (Waiting for Connection)';

    if (elPipeSyncMode) {
      if (receiverData.nqptpActive && receiverData.nqptpMasterClockId) {
        elPipeSyncMode.textContent = `Locked (${receiverData.nqptpMasterClockId})`;
        elPipeSyncMode.className = 't-v status-ok';
      } else if (receiverData.nqptpActive) {
        elPipeSyncMode.textContent = 'PTP Shared Clock Active';
        elPipeSyncMode.className = 't-v status-ok';
      } else {
        elPipeSyncMode.textContent = 'PTP Standby';
        elPipeSyncMode.className = 't-v';
      }
    }

    if (elPipeWsPing && wsLatencyMs !== null) elPipeWsPing.textContent = `${wsLatencyMs} ms`;

    // 6. Tab 2: Hardware Sparklines (Real Data from procfs)
    if (systemData.cpuLoad !== undefined) {
      cpuHistory.push(systemData.cpuLoad);
      if (cpuHistory.length > MAX_HISTORY) cpuHistory.shift();
      if (elChartCpuVal) elChartCpuVal.textContent = `${systemData.cpuLoad} (${systemData.cpuCount || 4} cores)`;
      updateSparklineSVG('cpu-line', 'cpu-area', cpuHistory, 0, 2.0);
    }

    if (systemData.temperatureC !== null && systemData.temperatureC !== undefined) {
      tempHistory.push(systemData.temperatureC);
      if (tempHistory.length > MAX_HISTORY) tempHistory.shift();
      if (elChartTempVal) elChartTempVal.textContent = `${systemData.temperatureC} °C`;
      updateSparklineSVG('temp-line', 'temp-area', tempHistory, 30, 75);
    }

    if (systemData.memPercent !== undefined) {
      memHistory.push(systemData.memPercent);
      if (memHistory.length > MAX_HISTORY) memHistory.shift();
      if (elChartMemVal) elChartMemVal.textContent = `${systemData.memPercent}% (${systemData.memUsedMb} MB)`;
      updateSparklineSVG('mem-line', 'mem-area', memHistory, 0, 100);
    }

    if (elHwHost) elHwHost.textContent = `Host: ${systemData.hostname || 'airplay'}`;
    if (elHwUptime) elHwUptime.textContent = `Uptime: ${formatUptime(systemData.uptimeSec)}`;
    if (elHwKernel && systemData.kernel) elHwKernel.textContent = `Kernel: ${systemData.kernel}`;
  }

  // ========================================================
  // Immediate Initial Fetch & Communication Sockets
  // ========================================================
  async function fetchInitial() {
    try {
      const t0 = performance.now();
      const res = await fetch('/api/status');
      const rtt = Math.round(performance.now() - t0);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          if (wsLatencyMs === null) {
            wsLatencyMs = rtt;
            if (elPipeWsPing) elPipeWsPing.textContent = `${wsLatencyMs} ms`;
          }
          render(json.data);
        }
      }
    } catch (e) {}
  }

  function initSSE() {
    try {
      const sse = new EventSource('/api/events');
      sse.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'init' || msg.type === 'state') {
            render(msg.data);
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  let ws = null;
  function initWS() {
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/`);

      ws.onopen = () => {
        // Send initial ping immediately upon connection
        lastPingSend = Date.now();
        ws.send(JSON.stringify({ type: 'ping', time: lastPingSend }));

        setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            lastPingSend = Date.now();
            ws.send(JSON.stringify({ type: 'ping', time: lastPingSend }));
          }
        }, 2000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'pong') {
            wsLatencyMs = Date.now() - msg.clientTime;
            if (elPipeWsPing) elPipeWsPing.textContent = `${wsLatencyMs} ms`;
          } else if (msg.type === 'init' || msg.type === 'state') {
            render(msg.data);
          }
        } catch (e) {}
      };

      ws.onclose = () => setTimeout(initWS, 3000);
    } catch (e) {}
  }

  // ========================================================
  // Desktop Window Controls & Keyboard Shortcuts
  // ========================================================
  const isLocalDisplay = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  async function triggerWindowAction(action) {
    if (!isLocalDisplay) {
      if (action === 'fullscreen') {
        toggleBrowserFullscreen();
      }
      return;
    }
    try {
      await fetch(`/api/system/window/${action}`, { method: 'POST' });
    } catch (e) {}
  }

  function toggleBrowserFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Minimize buttons (Header and Side Pill)
  const btnWindowMinimize = document.getElementById('btn-window-minimize');
  const sidePillMinimize = document.getElementById('side-pill-minimize');
  if (btnWindowMinimize) {
    btnWindowMinimize.addEventListener('click', () => triggerWindowAction('minimize'));
  }
  if (sidePillMinimize) {
    sidePillMinimize.addEventListener('click', () => triggerWindowAction('minimize'));
  }

  // Fullscreen buttons
  const btnWindowFullscreen = document.getElementById('btn-window-fullscreen');
  const sidePillFullscreen = document.getElementById('side-pill-fullscreen');
  if (btnWindowFullscreen) {
    btnWindowFullscreen.addEventListener('click', () => {
      toggleBrowserFullscreen();
      triggerWindowAction('fullscreen');
    });
  }
  if (sidePillFullscreen) {
    sidePillFullscreen.addEventListener('click', () => {
      toggleBrowserFullscreen();
      triggerWindowAction('fullscreen');
    });
  }

  // Close / Stop button
  const btnWindowClose = document.getElementById('btn-window-close');
  if (btnWindowClose) {
    btnWindowClose.addEventListener('click', () => {
      if (confirm('Stop the AirPlay Dashboard display and return to Raspberry Pi desktop?')) {
        triggerWindowAction('close');
      }
    });
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Ignore keypresses if user is typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toLowerCase();

    // '1' -> Tab 1 (Now Playing)
    if (key === '1') {
      switchTab('now-playing');
    }
    // '2' -> Tab 2 (Advanced Diagnostics)
    else if (key === '2') {
      switchTab('diagnostics');
    }
    // 't' -> Toggle Tab
    else if (key === 't') {
      const isNowPlaying = viewNowPlaying.classList.contains('active');
      switchTab(isNowPlaying ? 'diagnostics' : 'now-playing');
    }
    // Window management shortcuts ONLY apply on the physical Raspberry Pi display
    if (isLocalDisplay) {
      if (key === 'm' || key === 'd') {
        e.preventDefault();
        triggerWindowAction('minimize');
      } else if (key === 'q') {
        e.preventDefault();
        triggerWindowAction('close');
      } else if (e.key === 'F11') {
        e.preventDefault();
        toggleBrowserFullscreen();
        triggerWindowAction('fullscreen');
      } else if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          triggerWindowAction('minimize');
        }
      }
    } else {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleBrowserFullscreen();
      }
    }
  });

  // Bootstrap
  fetchInitial();
  initSSE();
  initWS();
  setInterval(fetchInitial, 2000);

})();
