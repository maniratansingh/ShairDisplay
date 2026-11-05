#!/bin/bash
# ========================================================
# ShairDisplay — Persistent Kiosk Display Launcher & Supervisor
# ========================================================

export DISPLAY="${DISPLAY:-:0}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"

LOG_FILE="/tmp/airplay-dashboard-display.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting ShairDisplay kiosk supervisor..."

# 1. Wait for local dashboard backend service to become ready
MAX_WAIT=30
WAIT_COUNT=0
until curl -s -f http://127.0.0.1:8080/api/status >/dev/null 2>&1; do
  WAIT_COUNT=$((WAIT_COUNT + 1))
  if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Timeout waiting for dashboard backend on port 8080. Proceeding anyway..."
    break
  fi
  sleep 1
done
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Dashboard backend is active and reachable."

PROFILE_DIR="/tmp/airplay-dashboard-chrome-profile"
mkdir -p "$PROFILE_DIR"

# Clear any intentional quit flag from earlier session
rm -f "/tmp/airplay-dashboard-intentional-quit" 2>/dev/null

# 2. Supervisor loop: ensures Chromium auto-respawns on crash or GPU hitch
while true; do
  # Clean up stale Chromium lockfiles before every launch (survives sudden power-cuts)
  rm -f "$PROFILE_DIR/Singleton*" "$PROFILE_DIR/lockfile" 2>/dev/null

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Launching Chromium in fullscreen application mode..."
  /usr/bin/chromium \
    --app=http://127.0.0.1:8080 \
    --start-maximized \
    --start-fullscreen \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --disable-features=Translate \
    --password-store=basic \
    --check-for-update-interval=31536000 \
    --simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'

  EXIT_CODE=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Chromium process ended with exit code $EXIT_CODE."

  # If user intentionally clicked Close or pressed 'Q', respect it and stop supervisor
  if [ -f "/tmp/airplay-dashboard-intentional-quit" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Intentional quit flag detected. Halting display supervisor."
    rm -f "/tmp/airplay-dashboard-intentional-quit" 2>/dev/null
    break
  fi

  # Crash recovery: wait 2 seconds before respawning to prevent high CPU loop
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Display process exited unexpectedly. Auto-recovering in 2 seconds..."
  sleep 2
done
