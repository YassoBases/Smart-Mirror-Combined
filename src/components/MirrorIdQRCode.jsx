import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Renders a QR code that encodes the Mirror ID as a JSON payload
 * the phone app can recognize:
 *   { type: "smart-mirror-pair", mirrorId: "<uuid>", v: 1 }
 *
 * The phone scans this, parses the JSON, extracts mirrorId, and calls
 *   PATCH /api/profiles/:id/mirror   { mirrorId }
 * to link the active profile to this mirror.
 */
const MirrorIdQRCode = ({ mirrorId, size = 180 }) => {
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mirrorId) return;
    const payload = JSON.stringify({
      type: 'smart-mirror-pair',
      mirrorId,
      v: 1,
    });
    QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch((err) => setError(err.message || 'QR generation failed'));
  }, [mirrorId, size]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-xs p-3"
        style={{ width: size, height: size }}
      >
        {error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-gray-700/40 border border-gray-600 text-gray-500 text-xs"
        style={{ width: size, height: size }}
      >
        Generating…
      </div>
    );
  }

  return (
    <div
      className="rounded-lg bg-white p-2 shadow-md"
      style={{ width: size + 16, height: size + 16 }}
    >
      <img
        src={dataUrl}
        alt="Mirror ID QR code"
        width={size}
        height={size}
        className="block"
        draggable={false}
      />
    </div>
  );
};

export default MirrorIdQRCode;
