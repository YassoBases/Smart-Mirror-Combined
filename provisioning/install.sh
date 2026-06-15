#!/usr/bin/env bash
#
# Install / refresh the Smart Mirror BLE WiFi-provisioning systemd units.
# Resolves the repo location from this script's path, so it works no matter where
# the repo is cloned (fixes the old hardcoded /home/pi/... path that broke installs).
#
# Usage:  sudo ./provisioning/install.sh
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This installer must run as root. Re-running with sudo…" >&2
  exec sudo -- "$0" "$@"
fi

PROV="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SYSD="/etc/systemd/system"
PY="/usr/bin/python3"

echo "Repo provisioning dir: $PROV"

# --- main boot unit: rewrite paths to the real deploy location -----------------
sed -e "s|^ExecStart=.*|ExecStart=$PY $PROV/ble-setup.py|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$PROV|" \
    "$PROV/smartmirror-ble-setup.service" > "$SYSD/smartmirror-ble-setup.service"
echo "Installed $SYSD/smartmirror-ble-setup.service"

# --- on-demand re-provision unit (Change WiFi later), if present ----------------
if [[ -f "$PROV/smartmirror-ble-reprovision.service" ]]; then
  sed -e "s|^ExecStart=.*|ExecStart=$PY $PROV/ble-setup.py --force|" \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=$PROV|" \
      "$PROV/smartmirror-ble-reprovision.service" > "$SYSD/smartmirror-ble-reprovision.service"
  echo "Installed $SYSD/smartmirror-ble-reprovision.service"
fi

# --- bluetooth.service boot-race drop-in --------------------------------------
install -d "$SYSD/bluetooth.service.d"
install -m 0644 "$PROV/bluetooth.service.d/10-smartmirror.conf" \
    "$SYSD/bluetooth.service.d/10-smartmirror.conf"
echo "Installed $SYSD/bluetooth.service.d/10-smartmirror.conf"

# --- drop the now-redundant hand-made override (ordering is in the main unit) --
if [[ -d "$SYSD/smartmirror-ble-setup.service.d" ]]; then
  rm -rf "$SYSD/smartmirror-ble-setup.service.d"
  echo "Removed stale $SYSD/smartmirror-ble-setup.service.d/ (folded into main unit)"
fi

# --- "Change WiFi" trigger: privilege-separated, no backend root ---------------
# The non-root backend drops /run/smartmirror/reprovision-request; a root .path
# unit reacts and starts the re-provision unit. The backend gets zero root.
RUN_USER="${SUDO_USER:-$(stat -c '%U' "$(dirname "$PROV")")}"

# Sentinel directory (recreated on each boot — /run is tmpfs), owned by the backend.
sed "s/__USER__/$RUN_USER/g" "$PROV/tmpfiles-smartmirror.conf" \
    > "/etc/tmpfiles.d/smartmirror.conf"
systemd-tmpfiles --create "/etc/tmpfiles.d/smartmirror.conf"
echo "Installed /etc/tmpfiles.d/smartmirror.conf (sentinel dir owner: $RUN_USER)"

# Root watcher units (fixed paths — no rewrite needed).
install -m 0644 "$PROV/smartmirror-ble-reprovision-trigger.path" \
    "$SYSD/smartmirror-ble-reprovision-trigger.path"
install -m 0644 "$PROV/smartmirror-ble-reprovision-trigger.service" \
    "$SYSD/smartmirror-ble-reprovision-trigger.service"
echo "Installed reprovision trigger .path/.service"

# Defensively remove any earlier sudoers-based trigger (superseded by the watcher).
rm -f "/etc/sudoers.d/10-smartmirror-ble"

systemctl daemon-reload
systemctl enable smartmirror-ble-setup.service
systemctl enable --now smartmirror-ble-reprovision-trigger.path
# The re-provision unit + trigger service are started on demand only.

echo "Done. Reboot or 'systemctl restart smartmirror-ble-setup.service' to apply."
