const express = require("express");
const cors = require("cors");
const path = require("path");
const os = require("os");

const authRoutes = require("./routes/auth");
const householdRoutes = require("./routes/households");
const profileRoutes = require("./routes/profiles");
const gmailRoutes = require("./routes/gmail");
const spotifyRoutes = require("./routes/spotify");
const mirrorsRoutes = require("./routes/mirrors");
const devicesRoutes    = require("./routes/devices");
const alertsRoutes     = require("./routes/alerts");
const newsRoutes       = require("./routes/news");
const { getByMirrorId } = require("./controllers/profileController");

const app = express();

// Open CORS for development — allows:
//   - Mirror UI on the same machine (localhost:3001)
//   - Mirror UI served from the Pi over the LAN (192.168.x.x:3001)
//   - Flutter web preview (localhost:8080)
// Lock this down to specific origins before any public deployment.
app.use(cors());
app.use(express.json());

// Serve uploaded faces statically at http://127.0.0.1:3000/faces/filename.jpg
app.use("/faces", express.static(path.join(__dirname, "../data/faces")));

// Serve alert snapshot images at http://<host>:3000/alert-snapshots/filename.jpg
app.use("/alert-snapshots", express.static(path.join(__dirname, "../data/alert-snapshots")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/households", householdRoutes);
app.use("/api/profiles", profileRoutes);
// Gmail OAuth callback — Google calls this directly, no JWT
app.use("/api/gmail", gmailRoutes);
// Spotify OAuth callback — Spotify calls this directly, no JWT
app.use("/api/spotify", spotifyRoutes);

// Public mirror endpoint — no auth, used by the mirror display (profile list)
app.get("/api/mirror/:mirrorId/profiles", getByMirrorId);

// Mirror routes — active user polling, Gmail status, Gmail messages
app.use("/api/mirrors", mirrorsRoutes);

// FCM device token registration (authenticated)
app.use("/api/devices", devicesRoutes);

// Security alerts — store & fetch unknown-face alerts (authenticated)
app.use("/api/alerts", alertsRoutes);

// RSS proxy — server-side fetch avoids client CORS issues (no auth, allowlisted hosts)
app.use("/api/news", newsRoutes);

// Health check — useful for the mirror to verify connectivity
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Network info — the mirror UI is a browser and can't read the Pi's LAN IP,
// so the backend surfaces it here. The pairing QR embeds the returned
// apiBaseUrl so the phone self-configures the right host on any network
// (home WiFi or hotspot). See MirrorIdQRCode.jsx.
app.get("/api/mirror/netinfo", (_req, res) => {
  const port = Number(process.env.PORT) || 3000;

  // Explicit override for multi-interface / edge-case hosts (see backend/.env).
  let ip = process.env.MIRROR_LAN_IP || null;

  if (!ip) {
    // Skip virtual/container interfaces — they produce unreachable IPs for phones.
    const VIRTUAL_IFACE = /^(docker|br-|veth|tun|tap|tailscale|zt|wg|virbr)/;
    const candidates = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      if (VIRTUAL_IFACE.test(name)) continue;
      for (const a of addrs || []) {
        if (a.family === "IPv4" && !a.internal) {
          candidates.push({ name, address: a.address });
        }
      }
    }

    // Prefer a pinned interface name, else a common private range, else any.
    const pinned = process.env.MIRROR_LAN_IFACE
      ? candidates.find((c) => c.name === process.env.MIRROR_LAN_IFACE)
      : null;
    const isPrivate = (addr) =>
      /^192\.168\./.test(addr) ||
      /^10\./.test(addr) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(addr);
    const preferred = candidates.find((c) => isPrivate(c.address));

    ip = (pinned || preferred || candidates[0] || {}).address || null;
  }

  if (!ip) {
    return res.status(503).json({ error: "No LAN IPv4 address found" });
  }

  res.json({ apiBaseUrl: `http://${ip}:${port}/api`, ip, port });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler — reads the .status property thrown by services
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || "Internal server error" });
});

module.exports = app;
