#!/usr/bin/env python3
"""
Smart Mirror BLE WiFi provisioning daemon.
Runs at Pi boot via smartmirror-ble-setup.service.
Exits immediately if the Pi is already online.

GATT service:
  Service UUID:     4fafc201-1fb5-459e-8fcc-c5c9c3319143
  Networks  char:   beb5483e-36e1-4688-b7f5-ea07361b26a8  (read / notify)
  Credentials char: a9b1c2d3-e4f5-6789-abcd-ef0123456789  (write, encrypt-write)
  Status char:      c0d1e2f3-a4b5-6789-cdef-012345678901  (read / notify, encrypt-read)

Requirements:
  pip3 install bluezero
  sudo apt install bluez python3-gi python3-dbus network-manager
  sudo systemctl enable bluetooth
"""

import json
import logging
import socket
import subprocess
import sys
import threading
import time

from gi.repository import GLib  # python3-gi / gir1.2-glib-2.0

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [ble-setup] %(levelname)s %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

# Shared GATT UUIDs — must match mirror_ble_provisioner.dart in the phone app.
SERVICE_UUID     = '4fafc201-1fb5-459e-8fcc-c5c9c3319143'
NETWORKS_UUID    = 'beb5483e-36e1-4688-b7f5-ea07361b26a8'
CREDENTIALS_UUID = 'a9b1c2d3-e4f5-6789-abcd-ef0123456789'
STATUS_UUID      = 'c0d1e2f3-a4b5-6789-cdef-012345678901'


# ---------------------------------------------------------------------------
# NetworkManager helpers
# ---------------------------------------------------------------------------

def _nm_wait(timeout: int = 30) -> bool:
    """Block until NetworkManager is running (max timeout seconds)."""
    for _ in range(timeout):
        try:
            r = subprocess.run(
                ['nmcli', '-t', '-f', 'STATE', 'g'],
                capture_output=True, text=True, timeout=3,
            )
            if r.returncode == 0 and r.stdout.strip():
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def _nm_is_online() -> bool:
    try:
        r = subprocess.run(
            ['nmcli', '-t', '-f', 'CONNECTIVITY', 'g'],
            capture_output=True, text=True, timeout=5,
        )
        return r.stdout.strip() in ('full', 'limited')
    except Exception:
        return False


def _scan_networks() -> list:
    """Return [{ssid, secured}] via nmcli. Deduplicates SSIDs."""
    try:
        r = subprocess.run(
            ['nmcli', '-t', '-f', 'SSID,SECURITY', 'dev', 'wifi'],
            capture_output=True, text=True, timeout=15,
        )
        seen, nets = set(), []
        for line in r.stdout.splitlines():
            parts = line.split(':', 1)
            if len(parts) != 2:
                continue
            ssid, security = parts[0].strip(), parts[1].strip()
            if not ssid or ssid in seen:
                continue
            seen.add(ssid)
            nets.append({'ssid': ssid, 'secured': bool(security and security != '--')})
        return nets
    except Exception:
        return []


def _get_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('8.8.8.8', 80))
            return s.getsockname()[0]
    except Exception:
        return ''


def _connect_wifi(ssid: str, password: str) -> tuple:
    cmd = ['nmcli', 'dev', 'wifi', 'connect', ssid]
    if password:
        cmd += ['password', password]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            return True, ''
        return False, (r.stderr.strip() or r.stdout.strip())
    except subprocess.TimeoutExpired:
        return False, 'Connection timed out.'
    except Exception as e:
        return False, str(e)


def _bt_short_id() -> str:
    """Return the last 4 hex chars of the BT adapter MAC (e.g. 'A1B2')."""
    try:
        r = subprocess.run(
            ['bluetoothctl', 'show'], capture_output=True, text=True, timeout=5,
        )
        for line in r.stdout.splitlines():
            if 'Controller' in line:
                mac = line.split()[1]
                return mac.replace(':', '')[-4:].upper()
    except Exception:
        pass
    return '0000'


def _enc(obj) -> list:
    """JSON-encode obj and return as list of ints (byte array for bluezero)."""
    return list(json.dumps(obj).encode())


# ---------------------------------------------------------------------------
# BLE GATT peripheral
# ---------------------------------------------------------------------------

class _BleProvisioner:
    def __init__(self, adapter_addr: str):
        from bluezero import peripheral

        dev_name = f'Smart Mirror {_bt_short_id()}'
        log.info('BLE device name: "%s"', dev_name)

        self._p = peripheral.Peripheral(adapter_addr, local_name=dev_name)
        self._p.add_service(srv_id=1, uuid=SERVICE_UUID, primary=True)

        self._networks: list = _enc([])
        self._status: list   = _enc({'state': 'idle'})

        # Networks — phone reads the list of SSIDs the Pi can see.
        self._p.add_characteristic(
            srv_id=1, chr_id=1,
            uuid=NETWORKS_UUID,
            value=self._networks,
            notifying=False,
            flags=['read', 'notify'],
            read_callback=lambda: self._networks,
            write_callback=None,
            notify_callback=None,
        )
        # Credentials — phone writes {ssid, password}.
        # encrypt-write forces the link to be bonded/encrypted before the write
        # is accepted, so the WiFi password never travels over plaintext BLE.
        self._p.add_characteristic(
            srv_id=1, chr_id=2,
            uuid=CREDENTIALS_UUID,
            value=[],
            notifying=False,
            flags=['write', 'encrypt-write'],
            read_callback=None,
            write_callback=self._on_credentials_write,
            notify_callback=None,
        )
        # Status — phone subscribes to know when the Pi has connected.
        # Returns {state, ip, apiBaseUrl} on success so the app can skip QR scanning.
        self._p.add_characteristic(
            srv_id=1, chr_id=3,
            uuid=STATUS_UUID,
            value=self._status,
            notifying=False,
            flags=['read', 'notify', 'encrypt-read'],
            read_callback=lambda: self._status,
            write_callback=None,
            notify_callback=None,
        )

        self._creds_event = threading.Event()
        self._pending: dict = {}
        self._lock = threading.Lock()

    # Called from the GLib event-loop thread when the phone writes credentials.
    def _on_credentials_write(self, value, options):
        try:
            creds = json.loads(bytes(value).decode())
            with self._lock:
                self._pending = creds
            self._creds_event.set()
        except Exception as e:
            log.warning('Malformed credentials payload: %s', e)

    # _update_* methods are called from the provisioner thread.
    # GLib.idle_add queues the D-Bus notification onto the main loop thread.
    def _update_status(self, state: str, ip: str = '', api_base_url: str = '') -> None:
        obj: dict = {'state': state}
        if ip:
            obj['ip'] = ip
        if api_base_url:
            obj['apiBaseUrl'] = api_base_url
        self._status = _enc(obj)
        GLib.idle_add(self._notify_status)

    def _notify_status(self) -> bool:
        self._p.update_value(srv_id=1, chr_id=3, value=self._status)
        return GLib.SOURCE_REMOVE

    def _update_networks(self, nets: list) -> None:
        self._networks = _enc(nets)
        GLib.idle_add(self._notify_networks)

    def _notify_networks(self) -> bool:
        self._p.update_value(srv_id=1, chr_id=1, value=self._networks)
        return GLib.SOURCE_REMOVE

    # Runs in a background thread so the GLib loop (in main thread) stays responsive.
    def _provisioner_loop(self) -> None:
        log.info('Scanning for networks…')
        self._update_status('scanning')
        nets = _scan_networks()
        log.info('Found %d network(s)', len(nets))
        self._update_networks(nets)
        self._update_status('idle')

        while True:
            self._creds_event.wait()
            self._creds_event.clear()

            with self._lock:
                creds = dict(self._pending)

            ssid     = creds.get('ssid', '').strip()
            password = creds.get('password', '')
            if not ssid:
                log.warning('Empty SSID — ignoring')
                continue

            log.info('Connecting to "%s"…', ssid)
            self._update_status('connecting')

            ok, err = _connect_wifi(ssid, password)
            if ok:
                ip      = _get_lan_ip()
                api_url = f'http://{ip}:3000/api' if ip else ''
                log.info('Connected  IP=%s  apiBaseUrl=%s', ip, api_url)
                self._update_status('connected', ip=ip, api_base_url=api_url)
                # Allow the phone 3 s to read the final status before we exit.
                time.sleep(3)
                GLib.idle_add(self._quit_loop)
                return
            else:
                log.warning('Connection failed: %s', err)
                self._update_status('failed')
                # Keep advertising so the user can correct the password and retry.

    def _quit_loop(self) -> bool:
        self._p.main_loop.quit()
        return GLib.SOURCE_REMOVE

    def run(self) -> None:
        threading.Thread(
            target=self._provisioner_loop,
            name='provisioner',
            daemon=True,
        ).start()
        log.info('Starting BLE advertisement…')
        self._p.publish()   # Runs GLib mainloop — blocks until _quit_loop is called.


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    log.info('Waiting for NetworkManager…')
    if not _nm_wait(30):
        log.error('NetworkManager did not start — exiting')
        sys.exit(1)

    if _nm_is_online():
        log.info('Pi is already online — BLE setup not needed.')
        sys.exit(0)

    try:
        from bluezero import adapter as bz_adapter
    except ImportError:
        log.error('bluezero not installed.  Run: pip3 install bluezero')
        sys.exit(1)

    adapters = bz_adapter.list_adapters()
    if not adapters:
        log.error('No Bluetooth adapter found.  Is bluetoothd running?  Check rfkill.')
        sys.exit(1)

    provisioner = _BleProvisioner(adapters[0])
    provisioner.run()
    log.info('Provisioning complete.')


if __name__ == '__main__':
    main()
