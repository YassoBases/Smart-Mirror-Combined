import { useEffect } from 'react';
import { useMirrorSync } from '../hooks/useMirrorSync';
import { useGuestMode } from '../contexts/GuestModeContext';
import GestureControl from './GestureControl';

// This screen renders before the mirror, so SmartMirror's hand tracking is not
// mounted yet. GestureControl provides its own cursor + pinch-to-click here
// (face-recognition model off) so the QR/code screen is fully gesture-operable.

// ─── Main pairing / login screen ─────────────────────────────────────────────

export default function PairingScreen({ onComplete }) {
  const { phase, qrData, shortCode, qrExpiring, bridgeOnline, mirrorIp, factoryReset } = useMirrorSync();
  const { enterGuest } = useGuestMode();

  // Advance when phone connects via QR
  useEffect(() => {
    if (phase === 'ready') onComplete?.();
  }, [phase, onComplete]);

  // Advance after a short delay if the sync bridge is unreachable
  useEffect(() => {
    if (phase !== 'bridge_unavailable') return;
    const t = setTimeout(() => onComplete?.(), 1500);
    return () => clearTimeout(t);
  }, [phase, onComplete]);

  const handleEnterGuest = () => {
    enterGuest();
    onComplete?.();
  };

  const visible = phase === 'booting' || phase === 'pairing' || phase === 'bridge_unavailable';
  if (!visible) return null;

  const hasQR     = Boolean(qrData?.dataUrl);
  const isBooting = phase === 'booting';

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black text-white select-none overflow-hidden">

      {/* Hand-gesture cursor + pinch-to-click for the pairing screen (no face model). */}
      <GestureControl />

      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 55% 35% at 50% 52%, rgba(56,189,248,0.045) 0%, transparent 70%)'
        }}
      />

      {/* Status pill */}
      <div className="relative mb-12 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-white/25">
        <span className={`h-1 w-1 rounded-full ${bridgeOnline ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
        {bridgeOnline ? 'Sync connected' : 'Connecting…'}
      </div>

      {/* Headline */}
      <h1
        className="relative mb-2 text-5xl font-normal tracking-tight text-white/90"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        Welcome
      </h1>
      <p className="relative mb-12 text-[11px] uppercase tracking-[0.3em] text-white/25">
        Sign in or explore as a guest
      </p>

      {/* ── Two-column card ───────────────────────────────────────────────── */}
      <div
        className="relative flex items-stretch overflow-hidden"
        style={{
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '20px',
          background: 'rgba(15,15,15,0.95)',
        }}
      >
        {/* Left — QR sign-in */}
        <div className="flex w-64 flex-col items-center justify-between px-8 py-8">
          <p className="mb-6 text-[9px] uppercase tracking-[0.28em] text-white/22">
            Phone sign-in
          </p>

          <div className="relative flex flex-1 items-center justify-center">
            {hasQR ? (
              <div
                className="overflow-hidden rounded-xl"
                style={{
                  border: '1px solid rgba(255,255,255,0.07)',
                  opacity: qrExpiring ? 0.15 : 1,
                  transition: 'opacity 0.5s',
                }}
              >
                <img
                  src={qrData.dataUrl}
                  alt="Pairing QR code"
                  width={176}
                  height={176}
                />
              </div>
            ) : (
              <div
                className="flex h-44 w-44 flex-col items-center justify-center gap-3 rounded-xl"
                style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}
              >
                <Spinner />
                <span className="text-[10px] tracking-wider text-white/20">
                  {isBooting ? 'Starting…' : 'Waiting…'}
                </span>
              </div>
            )}

            {qrExpiring && hasQR && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                <span className="rounded-full bg-black/90 px-3 py-1 text-[10px] tracking-[0.2em] text-amber-400/70 uppercase">
                  Refreshing
                </span>
              </div>
            )}
          </div>

          {shortCode && !qrExpiring ? (
            <div className="mt-6 text-center">
              <p className="mb-2 text-[9px] uppercase tracking-[0.28em] text-white/20">
                Or enter code
              </p>
              <p className="font-mono text-2xl font-light tracking-[0.35em] text-white/80">
                {shortCode}
              </p>
            </div>
          ) : (
            <p className="mt-6 text-center text-[10px] leading-relaxed tracking-wide text-white/18">
              Open the mirror app<br />and scan to pair
            </p>
          )}

          {/* Mirror IP — shown so users can verify both devices are on the same network */}
          {mirrorIp && mirrorIp !== '127.0.0.1' && (
            <div className="mt-4 text-center">
              <p className="text-[8px] uppercase tracking-[0.2em] text-white/15">Mirror IP</p>
              <p className="font-mono text-[11px] text-white/35 mt-0.5">{mirrorIp}</p>
            </div>
          )}
          {mirrorIp === '127.0.0.1' && (
            <p className="mt-4 text-center text-[9px] text-amber-400/50 leading-relaxed">
              No Wi-Fi detected — phone<br />cannot connect via QR
            </p>
          )}
        </div>

        {/* Center divider */}
        <div className="flex flex-col items-center justify-center py-8 px-0">
          <div className="w-px flex-1" style={{ background: 'rgba(255,255,255,0.05)' }} />
          <span className="my-4 text-[9px] uppercase tracking-[0.22em] text-white/15">or</span>
          <div className="w-px flex-1" style={{ background: 'rgba(255,255,255,0.05)' }} />
        </div>

        {/* Right — Guest mode */}
        <div className="flex w-64 flex-col items-center justify-between px-8 py-8">
          <p className="mb-6 text-[9px] uppercase tracking-[0.28em] text-white/22">
            Guest mode
          </p>

          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
            >
              <svg className="w-6 h-6 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>

            <div>
              <p className="text-sm font-medium text-white/75">Guest Mode</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/28">
                All widgets, no account
              </p>
            </div>

            {/* Gesture-clickable — SmartMirror's pinch handler fires el.click()
                on whatever element is under the cursor, including this button */}
            <button
              onClick={handleEnterGuest}
              className="rounded-full px-8 py-2.5 text-xs tracking-[0.14em] text-white/50 transition-all duration-200 hover:text-white/80"
              style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.025)' }}
            >
              Enter Mirror
            </button>

            <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-white/15">
              <span style={{ fontSize: '11px' }}>✋</span>
              Pinch to select
            </p>
          </div>

          <p className="mt-4 text-center text-[10px] tracking-wide text-white/15">
            No account needed
          </p>
        </div>
      </div>

      {/* Footer */}
      <p className="relative mt-8 text-[9px] uppercase tracking-[0.28em] text-white/15">
        Code refreshes every 5 minutes
      </p>

      <button
        onClick={factoryReset}
        className="relative mt-3 text-[9px] uppercase tracking-[0.2em] text-white/15 transition-colors hover:text-white/30"
      >
        Reset device
      </button>
    </div>
  );
}

// ─── Account/guest button shown in Settings ───────────────────────────────────

export function DeviceAccountButton({ className = '' }) {
  const { phase, factoryReset } = useMirrorSync();
  const { guestMode, exitGuest } = useGuestMode();

  if (guestMode) {
    return (
      <button
        onClick={exitGuest}
        className={`rounded border border-amber-500/30 px-3 py-1 text-xs text-amber-400/70
                    hover:border-amber-400/50 hover:text-amber-300/90 transition-colors ${className}`}
      >
        Exit Guest Mode
      </button>
    );
  }

  if (phase !== 'ready' && phase !== 'offline' && phase !== 'connecting') return null;

  return (
    <button
      onClick={() => {
        if (window.confirm('Unlink this mirror and restart pairing?')) factoryReset();
      }}
      className={`rounded border border-white/[0.08] px-3 py-1 text-xs text-white/35
                  hover:border-white/20 hover:text-white/60 transition-colors ${className}`}
    >
      Unlink device
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-7 w-7 animate-spin text-white/15" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
