// At the top of src/pages/Settings.jsx, add this import alongside the others:
import MirrorIdQRCode from '../components/MirrorIdQRCode';

// Replace the existing "Mirror ID" block inside the Users section with this:
{/* Mirror ID */}
<div className="mb-6">
  <p className="text-sm text-gray-300 mb-2 font-medium">Mirror ID</p>

  <div className="flex flex-col md:flex-row gap-4 items-start">
    {/* QR code — scan with the mobile app to link */}
    <MirrorIdQRCode mirrorId={backendApi.getMirrorId()} size={180} />

    {/* ID + copy button + helper text */}
    <div className="flex-1 min-w-0 w-full">
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-xs text-gray-200 font-mono tracking-wider break-all select-all">
          {backendApi.getMirrorId()}
        </code>
        <button
          type="button"
          onClick={handleCopyMirrorId}
          className="text-xs border border-gray-600 rounded px-3 py-2 hover:border-gray-400 hover:text-white transition whitespace-nowrap"
          style={{ color: mirrorIdCopied ? 'var(--mirror-accent-color,#38bdf8)' : undefined }}
        >
          {mirrorIdCopied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Scan the QR code with the mobile app — or copy this ID and paste it manually
        in the app under <span className="text-gray-300">Profile → Mirror → Link</span>.
      </p>
    </div>
  </div>
</div>
