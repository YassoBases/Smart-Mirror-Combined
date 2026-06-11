import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Must match wifi-guard.sh defaults (or whatever is printed in the box).
const PORTAL_SSID = 'SmartMirror-Setup';
const PORTAL_PASSPHRASE = 'SmartMirror1';
const PORTAL_URL = 'http://192.168.42.1';

/**
 * Shown on the HDMI display when the Pi has no LAN IP (netinfo returns 503).
 * Renders setup steps + a WiFi-join QR so the customer knows what to do
 * without needing to read a manual.
 *
 * The parent (App.jsx AppShell) polls /api/mirror/netinfo and unmounts this
 * component once the Pi comes online.
 */
export default function SetupMode() {
  const [wifiQrUrl, setWifiQrUrl] = useState('');

  useEffect(() => {
    // Standard WiFi QR format — iOS Camera app and Android scan natively.
    const wifiString = `WIFI:S:${PORTAL_SSID};T:WPA;P:${PORTAL_PASSPHRASE};;`;
    QRCode.toDataURL(wifiString, {
      width: 180,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setWifiQrUrl)
      .catch(() => {});
  }, []);

  const steps = [
    {
      title: `Join the hotspot`,
      body: (
        <>
          On your phone go to <strong>WiFi Settings</strong> and connect to{' '}
          <span className="text-white/85 font-medium">"{PORTAL_SSID}"</span>
          <br />
          Password: <span className="text-white/85 font-medium">{PORTAL_PASSPHRASE}</span>
        </>
      ),
    },
    {
      title: 'Open the setup page',
      body: (
        <>
          A page should open automatically. If not, visit{' '}
          <span className="text-white/60">{PORTAL_URL}</span> in your browser.
        </>
      ),
    },
    {
      title: 'Pick your home WiFi',
      body: 'Choose your network, enter the password, and tap Connect. The mirror will join and this screen will update.',
    },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black text-white select-none overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 35% at 50% 52%, rgba(56,189,248,0.04) 0%, transparent 70%)',
        }}
      />

      <div className="relative flex flex-col lg:flex-row items-center gap-12 max-w-3xl px-8 py-10">
        {/* ── Left: instructions ── */}
        <div className="flex-1">
          {/* Status pill */}
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-white/25 mb-10">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            Waiting for WiFi
          </div>

          <h1
            className="text-4xl font-normal tracking-tight text-white/90 mb-3"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Set up WiFi
          </h1>
          <p className="text-sm text-white/40 mb-8 leading-relaxed">
            Your mirror isn't connected to a network yet. Follow these steps to get it online.
          </p>

          <ol className="space-y-6">
            {steps.map(({ title, body }, i) => (
              <li key={i} className="flex gap-4">
                <span
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black"
                  style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/85 mb-0.5">{title}</p>
                  <p className="text-xs text-white/40 leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* ── Right: WiFi join QR ── */}
        <div className="flex flex-col items-center gap-4 flex-shrink-0">
          {wifiQrUrl ? (
            <>
              <div className="rounded-2xl bg-white p-3 shadow-xl">
                <img
                  src={wifiQrUrl}
                  alt={`Scan to join ${PORTAL_SSID}`}
                  width={180}
                  height={180}
                  className="block"
                  draggable={false}
                />
              </div>
              <p className="text-[11px] text-white/30 text-center leading-relaxed">
                Scan to join
                <br />
                <span className="text-white/55 font-medium">{PORTAL_SSID}</span>
              </p>
            </>
          ) : (
            <div
              className="rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/20 text-xs"
              style={{ width: 206, height: 206 }}
            >
              Generating…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
