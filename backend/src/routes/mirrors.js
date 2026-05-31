const router = require('express').Router();
const { getDb } = require('../config/database');
const gmailService = require('../services/gmailService');
const spotifyService = require('../services/spotifyService');
const { pairSession, pairByCode } = require('../services/mirrorSync');
const { authenticate } = require('../middleware/auth');
const { sendToHousehold } = require('../services/pushService');

// ── POST /api/mirrors/pair ────────────────────────────────────────────────────
// Phone calls this after scanning the mirror's QR code.
// Body: { sid, shortCode, phonePublicKey? }
// Auth: Bearer JWT (required — ties the mirror to the phone owner's account)
router.post('/pair', authenticate, async (req, res, next) => {
  try {
    const { sid, shortCode, phonePublicKey } = req.body;
    if (!sid || !shortCode) {
      return res.status(400).json({ error: 'sid and shortCode are required' });
    }
    const { mirrorId, deviceToken } = await pairSession(
      sid, shortCode, req.account.accountId, phonePublicKey
    );
    res.json({ mirrorId, deviceToken });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/mirrors/pair/code ───────────────────────────────────────────────
// Alternative pairing when the phone can't scan the QR (emulator, no camera).
// The user reads the 6-character short code shown on the mirror and types it here.
// Body: { shortCode }
// Auth: Bearer JWT
router.post('/pair/code', authenticate, async (req, res, next) => {
  try {
    const { shortCode, phonePublicKey } = req.body;
    if (!shortCode) {
      return res.status(400).json({ error: 'shortCode is required' });
    }
    const { mirrorId, deviceToken } = await pairByCode(
      shortCode, req.account.accountId, phonePublicKey
    );
    res.json({ mirrorId, deviceToken });
  } catch (err) {
    next(err);
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

// Resolve mirrorId → AI settings stored by the household that owns this mirror.
async function getAiSettingsForMirror(mirrorId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT mas.settings
     FROM mirror_ai_settings mas
     JOIN accounts a ON a.household_id = mas.household_id
     JOIN mirrors  m ON m.account_id   = a.id
     WHERE m.mirror_id = ?`,
    mirrorId
  );
  return row ? JSON.parse(row.settings) : null;
}

// Resolve mirrorId → profile row (with gmail_connected flag).
// Checks active_mirror_users first (explicit selection on mirror),
// then falls back to profiles.mirror_id (app-side pairing).
// Returns null when nothing is linked.
async function getActiveProfile(mirrorId) {
  const db = await getDb();

  const SELECT = `
    SELECT p.id, p.name, p.email, p.google_sub, p.mirror_id, p.widgets_config,
           CASE WHEN gc.profile_id  IS NOT NULL THEN 1 ELSE 0 END AS gmail_connected,
           CASE WHEN sc.profile_id  IS NOT NULL THEN 1 ELSE 0 END AS spotify_connected,
           sc.display_name AS spotify_display_name
    FROM profiles p
    LEFT JOIN gmail_connections   gc ON gc.profile_id = p.id
    LEFT JOIN spotify_connections sc ON sc.profile_id = p.id
  `;

  // Primary: explicitly selected active user
  const fromActive = await db.get(
    `${SELECT} JOIN active_mirror_users amu ON amu.profile_id = p.id WHERE amu.mirror_id = ?`,
    mirrorId
  );
  if (fromActive) return fromActive;

  // Fallback: profile linked via app (profiles.mirror_id)
  return db.get(
    `${SELECT} WHERE p.mirror_id = ? ORDER BY p.name LIMIT 1`,
    mirrorId
  );
}

// ── POST /api/mirrors/active-user ─────────────────────────────────────────────
// Body: { mirrorId, profileId }
// Called by the mirror when a user selects their profile on the mirror itself.
router.post('/active-user', async (req, res, next) => {
  try {
    const { mirrorId, profileId } = req.body;
    if (!mirrorId || !profileId) {
      return res.status(400).json({ error: 'mirrorId and profileId are required' });
    }

    const db = await getDb();

    // Verify the profile exists
    const profile = await db.get('SELECT id FROM profiles WHERE id = ?', profileId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    await db.run(
      `INSERT INTO active_mirror_users (mirror_id, profile_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(mirror_id) DO UPDATE SET
         profile_id = excluded.profile_id,
         updated_at = CURRENT_TIMESTAMP`,
      mirrorId, profileId
    );

    await db.run('UPDATE profiles SET mirror_id = ? WHERE id = ?', mirrorId, profileId);

    const active = await getActiveProfile(mirrorId);
    const widgetSettings = active.widgets_config ? JSON.parse(active.widgets_config) : undefined;
    const aiSettings = await getAiSettingsForMirror(mirrorId);
    res.json({
      profile: {
        id: active.id,
        name: active.name,
        settings:             widgetSettings,
        gmailConnected:       !!active.gmail_connected,
        gmailEmail:           active.email || null,
        spotifyConnected:     !!active.spotify_connected,
        spotifyDisplayName:   active.spotify_display_name || null,
      },
      aiSettings,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/mirrors/active-user?mid=<mirrorId> ───────────────────────────────
// Polled by the mirror UI to know who is the active user.
// mirrorId is passed as query param ?mid= to avoid URL path issues with
// base64 keys that contain '/' and '+'.
router.get('/active-user', async (req, res, next) => {
  try {
    const mirrorId = req.query.mid;
    if (!mirrorId) return res.json({ profile: null });
    const profile = await getActiveProfile(mirrorId);
    if (!profile) return res.json({ profile: null });
    const widgetSettings = profile.widgets_config ? JSON.parse(profile.widgets_config) : undefined;
    const aiSettings = await getAiSettingsForMirror(mirrorId);
    res.json({
      profile: {
        id: profile.id,
        name: profile.name,
        settings:           widgetSettings,
        gmailConnected:     !!profile.gmail_connected,
        gmailEmail:         profile.email || null,
        spotifyConnected:   !!profile.spotify_connected,
        spotifyDisplayName: profile.spotify_display_name || null,
      },
      aiSettings,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/mirrors/gmail/status?mid=<mirrorId> ──────────────────────────────
router.get('/gmail/status', async (req, res, next) => {
  try {
    const profile = await getActiveProfile(req.query.mid);
    if (!profile) return res.json({ connected: false, email: null });
    res.json({ connected: !!profile.gmail_connected, email: profile.email || null });
  } catch (err) { next(err); }
});

// ── GET /api/mirrors/gmail/messages?mid=<mirrorId> ────────────────────────────
router.get('/gmail/messages', async (req, res, next) => {
  try {
    const profile = await getActiveProfile(req.query.mid);
    if (!profile || !profile.gmail_connected) return res.json({ messages: [] });
    const messages = await gmailService.getInboxSummary(profile.id);
    res.json({ messages });
  } catch (err) {
    if (err.status === 404) return res.json({ messages: [] });
    next(err);
  }
});

// ── GET /api/mirrors/spotify/status?mid=<mirrorId> ────────────────────────────
router.get('/spotify/status', async (req, res, next) => {
  try {
    const profile = await getActiveProfile(req.query.mid);
    if (!profile) return res.json({ connected: false, displayName: null });
    res.json({ connected: !!profile.spotify_connected, displayName: profile.spotify_display_name || null });
  } catch (err) { next(err); }
});

// ── GET /api/mirrors/spotify/now-playing?mid=<mirrorId> ───────────────────────
router.get('/spotify/now-playing', async (req, res, next) => {
  try {
    const profile = await getActiveProfile(req.query.mid);
    if (!profile || !profile.spotify_connected) return res.json({ track: null });
    const track = await spotifyService.getCurrentlyPlaying(profile.id);
    res.json({ track });
  } catch (err) {
    if (err.status === 404) return res.json({ track: null });
    next(err);
  }
});

// ── GET /api/mirrors/spotify/player?mid=<mirrorId> ────────────────────────────
router.get('/spotify/player', async (req, res) => {
  try {
    const profile = await getActiveProfile(req.query.mid);
    if (!profile || !profile.spotify_connected) {
      return res.json({ connected: false });
    }

    // getFreshToken auto-refreshes expired tokens — always call this, never use cached token directly
    let token;
    try {
      token = await spotifyService.getFreshToken(profile.id);
    } catch (e) {
      console.warn('[mirrors] getFreshToken failed:', e.message);
      return res.json({ connected: false });
    }

    const spotifyRes = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    // 204 = authenticated but no active device / nothing playing
    if (spotifyRes.status === 204) {
      return res.json({
        connected:   true,
        displayName: profile.spotify_display_name || '',
        is_playing:  false,
        item:        null,
      });
    }

    if (!spotifyRes.ok) {
      // 403 = Spotify Premium required or dev-mode restriction — user IS connected, just no playback data
      // 401 = token genuinely invalid — treat as not connected
      console.warn('[mirrors] Spotify player returned %d', spotifyRes.status);
      if (spotifyRes.status === 401) return res.json({ connected: false });
      return res.json({
        connected:  true,
        displayName: profile.spotify_display_name || '',
        is_playing: false,
        item:       null,
      });
    }

    // Return raw Spotify response — mirror widget normalizes field names itself
    const player = await spotifyRes.json();
    res.json({
      connected:   true,
      displayName: profile.spotify_display_name || '',
      ...player,
    });
  } catch (err) {
    console.error('[mirrors] spotify/player error:', err.message);
    res.json({ connected: false });
  }
});

// ── POST /api/mirrors/spotify/control ────────────────────────────────────────
// Body: { mid: mirrorId, action: 'play' | 'pause' | 'next' | 'previous' }
router.post('/spotify/control', async (req, res) => {
  try {
    const profile = await getActiveProfile(req.body.mid);
    if (!profile || !profile.spotify_connected) {
      return res.status(403).json({ error: 'No Spotify session for this mirror' });
    }

    let token;
    try {
      token = await spotifyService.getFreshToken(profile.id);
    } catch (e) {
      return res.status(403).json({ error: 'Spotify token unavailable' });
    }

    const { action } = req.body;
    const endpointMap = {
      play:     { url: 'https://api.spotify.com/v1/me/player/play',     method: 'PUT' },
      pause:    { url: 'https://api.spotify.com/v1/me/player/pause',    method: 'PUT' },
      next:     { url: 'https://api.spotify.com/v1/me/player/next',     method: 'POST' },
      previous: { url: 'https://api.spotify.com/v1/me/player/previous', method: 'POST' },
    };

    const ep = endpointMap[action];
    if (!ep) return res.status(400).json({ error: 'Unknown action' });

    await fetch(ep.url, {
      method: ep.method,
      headers: { 'Authorization': `Bearer ${token}` },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[mirrors] spotify/control error:', err.message);
    res.status(500).json({ error: 'Spotify control failed' });
  }
});

// ── POST /api/mirrors/:mirrorId/unknown-face ──────────────────────────────────
// Called by the mirror when face recognition sees an unknown person.
// No auth — mirror-side fire-and-forget; resolved to household via mirror_id.
router.post('/:mirrorId/unknown-face', async (req, res, next) => {
  try {
    const { mirrorId } = req.params;
    const db = await getDb();

    const row = await db.get(
      `SELECT a.household_id
       FROM mirrors m
       JOIN accounts a ON a.id = m.account_id
       WHERE m.mirror_id = ?`,
      mirrorId,
    );

    if (!row) return res.status(404).json({ error: 'Mirror not found' });

    await sendToHousehold(row.household_id, {
      title: 'Security Alert',
      body:  'Unknown face detected at your mirror',
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
