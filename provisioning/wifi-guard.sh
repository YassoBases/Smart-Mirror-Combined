#!/usr/bin/env bash
# wifi-guard.sh — Smart Mirror boot guard for WiFi onboarding.
#
# Runs wifi-connect only when the Pi has no network connection at boot.
# Called by smartmirror-wifi-connect.service (ordered Before= the mirror
# services via systemd). Does nothing when the Pi is already connected.
#
# Prereqs:
#   - Raspberry Pi OS Bookworm (NetworkManager/nmcli must be present)
#   - wifi-connect binary from https://github.com/balena-os/wifi-connect/releases
#     Install: sudo install -m 755 wifi-connect /usr/local/bin/wifi-connect
#   - dnsmasq: sudo apt install -y dnsmasq
#
# Override defaults via environment or /etc/smartmirror/wifi-guard.env:
#   PORTAL_SSID        hotspot network name  (default: SmartMirror-Setup)
#   PORTAL_PASSPHRASE  hotspot WPA2 password (default: SmartMirror1)
#   PORTAL_GATEWAY     AP gateway IP         (default: 192.168.42.1)
#   WIFI_CONNECT       binary path           (default: /usr/local/bin/wifi-connect)

set -euo pipefail

PORTAL_SSID="${PORTAL_SSID:-SmartMirror-Setup}"
PORTAL_PASSPHRASE="${PORTAL_PASSPHRASE:-SmartMirror1}"
PORTAL_GATEWAY="${PORTAL_GATEWAY:-192.168.42.1}"
WIFI_CONNECT="${WIFI_CONNECT:-/usr/local/bin/wifi-connect}"

log() { echo "[wifi-guard] $*"; }

# ── Wait for NetworkManager to be operational (max 30 s) ─────────────────────
log "Waiting for NetworkManager…"
for i in $(seq 1 30); do
  if nmcli -t -f STATE g 2>/dev/null | grep -qE ".+"; then
    break
  fi
  sleep 1
done

# ── Read current NM state and connectivity ───────────────────────────────────
state=$(nmcli -t -f STATE g 2>/dev/null || echo "unknown")
connectivity=$(nmcli -t -f CONNECTIVITY g 2>/dev/null || echo "none")
log "NM state=$state  connectivity=$connectivity"

# ── Already connected — skip setup ──────────────────────────────────────────
if [[ "$connectivity" == "full" || "$connectivity" == "limited" ]]; then
  log "Already connected (connectivity=$connectivity). Skipping setup portal."
  exit 0
fi

if echo "$state" | grep -qi "connected"; then
  log "NM reports connected (state=$state). Skipping setup portal."
  exit 0
fi

# ── Verify wifi-connect is installed ─────────────────────────────────────────
if [[ ! -x "$WIFI_CONNECT" ]]; then
  log "ERROR: wifi-connect not found at '$WIFI_CONNECT'"
  log "Download the aarch64 build from:"
  log "  https://github.com/balena-os/wifi-connect/releases"
  log "Install:"
  log "  sudo install -m 755 wifi-connect /usr/local/bin/wifi-connect"
  exit 1
fi

# ── Launch setup portal — blocks until Pi connects to home WiFi ──────────────
log "No network — broadcasting setup AP: SSID='$PORTAL_SSID'  gateway=$PORTAL_GATEWAY"
log "wifi-connect will exit once the Pi joins the selected network."
exec "$WIFI_CONNECT" \
  --portal-ssid       "$PORTAL_SSID" \
  --portal-passphrase "$PORTAL_PASSPHRASE" \
  --portal-gateway    "$PORTAL_GATEWAY"
