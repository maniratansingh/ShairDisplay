#!/bin/bash
# ========================================================
# AirPlay 2 Music Dashboard — Persistent Display Launcher
# ========================================================

export DISPLAY="${DISPLAY:-:0}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"

LOG_FILE="/tmp/airplay-dashboard-display.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting AirPlay 2 Dashboard display launcher..."

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

# 2. Clean up any stale Chromium profile lock files from previous unclean reboots
PROFILE_DIR="/tmp/airplay-dashboard-chrome-profile"
mkdir -p "$PROFILE_DIR"
rm -f "$PROFILE_DIR/Singleton*" "$PROFILE_DIR/lockfile" 2>/dev/null

# 3. Clean any existing conflicting dashboard browser instances
pkill -f "airplay-dashboard-chrome-profile" 2>/dev/null
sleep 1

# 4. Launch Chromium in dedicated App mode with Fullscreen
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Launching Chromium in fullscreen application mode..."
exec /usr/bin/chromium \
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
