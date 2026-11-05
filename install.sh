#!/usr/bin/env bash
# ========================================================
# ShairDisplay — 1-Step Automated Installer
# ========================================================

set -e

echo "=========================================================="
echo "  Installing ShairDisplay (AirPlay 2 Hi-Fi Display)"
echo "=========================================================="

INSTALL_DIR="/opt/airplay-dashboard"
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Install required system packages
echo "--> Installing system packages (Node.js, Python Pillow, wlrctl, xdotool, wlopm)..."
sudo apt-get update
sudo apt-get install -y nodejs npm python3-pil wlrctl xdotool curl wlopm

# 2. Deploy to /opt/airplay-dashboard if not already running there
if [ "$CURRENT_DIR" != "$INSTALL_DIR" ]; then
  echo "--> Copying files to $INSTALL_DIR..."
  sudo mkdir -p "$INSTALL_DIR"
  sudo cp -r "$CURRENT_DIR"/* "$INSTALL_DIR/"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# 3. Install Node.js dependencies
echo "--> Installing npm dependencies..."
npm install --production

# 4. Configure display launcher permissions
chmod +x "$INSTALL_DIR/launch-display.sh"

# 5. Install and enable systemd backend service
echo "--> Configuring airplay-dashboard systemd service..."
sudo cp "$INSTALL_DIR/airplay-dashboard.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now airplay-dashboard.service

# 6. Configure Autostart on Boot (labwc / Raspberry Pi OS desktop)
echo "--> Configuring desktop autostart..."
mkdir -p "$HOME/.config/labwc" "$HOME/.config/autostart" "$HOME/Desktop"
if [ ! -f "$HOME/.config/labwc/autostart" ] || ! grep -q "launch-display.sh" "$HOME/.config/labwc/autostart"; then
  echo "$INSTALL_DIR/launch-display.sh >/tmp/airplay-dashboard-display.log 2>&1 &" >> "$HOME/.config/labwc/autostart"
  chmod +x "$HOME/.config/labwc/autostart"
fi

cp "$INSTALL_DIR/airplay-dashboard.desktop" "$HOME/.config/autostart/"
cp "$INSTALL_DIR/airplay-dashboard.desktop" "$HOME/Desktop/"
chmod +x "$HOME/Desktop/airplay-dashboard.desktop" 2>/dev/null || true

echo "=========================================================="
echo "  Installation Complete!"
echo "  • ShairDisplay Backend: Active at http://localhost:8080"
echo "  • Display Supervisor: Auto-starts on boot with crash recovery"
echo "  • To launch right now, run: $INSTALL_DIR/launch-display.sh &"
echo "=========================================================="
