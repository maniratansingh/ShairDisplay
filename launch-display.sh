#!/bin/bash
# ========================================================
# ShairDisplay — Hardened Kiosk Display Launcher
# ========================================================

# 1. Guarantee single instance with flock (prevents dual-execution loops)
LOCK_FILE="/tmp/airplay-dashboard-launcher.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ShairDisplay launcher is already running. Exiting."
  exit 0
fi

export DISPLAY="${DISPLAY:-:0}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"

LOG_FILE="/tmp/airplay-dashboard-display.log"
exec > >(tee "$LOG_FILE") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting ShairDisplay kiosk launcher..."

# 2. Wait for dashboard backend service to become ready (up to 30s)
MAX_WAIT=30
WAIT_COUNT=0
until curl -s -f http://127.0.0.1:8080/api/status >/dev/null 2>&1; do
  WAIT_COUNT=$((WAIT_COUNT + 1))
  if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Timeout waiting for dashboard on port 8080. Proceeding anyway..."
    break
  fi
  sleep 1
done
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Dashboard backend is active and reachable."

PROFILE_DIR="/tmp/airplay-dashboard-chrome-profile"
mkdir -p "$PROFILE_DIR"

# 3. Clean any existing orphaned dashboard Chromium processes and stale locks
pkill -f "airplay-dashboard-chrome-profile" 2>/dev/null
sleep 1
rm -f "$PROFILE_DIR/Singleton*" "$PROFILE_DIR/lockfile" 2>/dev/null
rm -f "/tmp/airplay-dashboard-intentional-quit" 2>/dev/null

CRASH_COUNT=0
MAX_CRASHES=3

# 4. Supervised launch loop: only restarts on actual crashes (exit code != 0)
while true; do
  rm -f "$PROFILE_DIR/Singleton*" "$PROFILE_DIR/lockfile" 2>/dev/null

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Launching Chromium fullscreen kiosk..."
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

  # Exit code 0 means clean exit (or intentional close): do NOT restart
  if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Clean shutdown detected. Stopping launcher."
    break
  fi

  # If user intentionally quit (via 'Q' or API): do NOT restart
  if [ -f "/tmp/airplay-dashboard-intentional-quit" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Intentional quit flag set. Stopping launcher."
    rm -f "/tmp/airplay-dashboard-intentional-quit" 2>/dev/null
    break
  fi

  # Abnormal crash handling (exit code != 0)
  CRASH_COUNT=$((CRASH_COUNT + 1))
  if [ $CRASH_COUNT -gt $MAX_CRASHES ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Chromium crashed $CRASH_COUNT times in succession. Halting to avoid loop."
    break
  fi

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Crash detected (exit $EXIT_CODE). Restarting in 3 seconds (attempt $CRASH_COUNT of $MAX_CRASHES)..."
  sleep 3
done
