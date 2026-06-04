// Mirror ↔ Backend API service
// Connects the mirror to the Node.js/Express backend for login, profiles, and user management.

// Use window.location.hostname so the phone browser's API calls go to the
// mirror's LAN IP (e.g. 192.168.1.25:3000) instead of localhost:3000.
// REACT_APP_API_URL overrides this for staging/production deployments.
const API_URL = (
  process.env.REACT_APP_API_URL ||
  `http://${window.location.hostname}:3000`
).replace(/\/$/, '');

const TOKEN_KEY = 'mirrorBackendToken';

export const backendApi = {
  // ── Auth ────────────────────────────────────────────────────────────────

  getToken: () => localStorage.getItem(TOKEN_KEY),

  isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event('storage'));
  },

  login: async (email, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Login failed');
    localStorage.setItem(TOKEN_KEY, data.token);
    return data; // { token, accountId, householdId, email }
  },

  // ── Profiles ─────────────────────────────────────────────────────────────

  _authHeaders: () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}`,
  }),

  getProfiles: async () => {
    const res = await fetch(`${API_URL}/api/profiles`, {
      headers: backendApi._authHeaders(),
    });
    if (res.status === 401) { backendApi.logout(); throw new Error('Session expired'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch profiles');
    return data; // [{ id, householdId, name, email, googleSub, createdAt }]
  },

  addProfile: async (name) => {
    const res = await fetch(`${API_URL}/api/profiles`, {
      method: 'POST',
      headers: backendApi._authHeaders(),
      body: JSON.stringify({ name }),
    });
    if (res.status === 401) { backendApi.logout(); throw new Error('Session expired'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add profile');
    return data; // { id, householdId, name, email, googleSub, createdAt }
  },

  // ── Mirror sync ───────────────────────────────────────────────────────────

  /**
   * Returns this mirror's permanent ID (a UUID).
   * Generated once on first call and persisted in localStorage.
   * The phone app enters this ID to link itself to this mirror.
   */
  getMirrorId: () => {
    const MIRROR_ID_KEY = 'smartMirrorId';
    let id = localStorage.getItem(MIRROR_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(MIRROR_ID_KEY, id);
      console.log('[Mirror] Generated new Mirror ID:', id);
    } else {
      console.log('[Mirror] Loaded existing Mirror ID:', id);
    }
    return id;
  },

  /**
   * Polls the backend for whichever profile the phone app last activated.
   * Returns { id, name, email, gmailConnected, gmailEmail } or null.
   * No login needed — mirror identifies itself by its UUID.
   */
  getActiveUser: async (mirrorId) => {
    const url = `${API_URL}/api/mirrors/active-user?mid=${encodeURIComponent(mirrorId)}`;
    try {
      console.log('[Mirror] Polling:', url);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn('[Mirror] Poll failed — HTTP', res.status, url);
        return null;
      }
      const data = await res.json();
      console.log('[Mirror] Poll response:', data);
      return data.profile || null;
    } catch (err) {
      console.warn('[Mirror] Poll error:', err.message, url);
      return null;
    }
  },

  /**
   * Tells the backend which profile is now active on this mirror.
   * Called by the mirror when face recognition switches the active user.
   * Body: { mirrorId, profileId }
   */
  setActiveMirrorUser: async (mirrorId, profileId) => {
    try {
      await fetch(`${API_URL}/api/mirrors/active-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mirrorId, profileId }),
      });
    } catch (e) {
      console.warn('[Mirror] setActiveMirrorUser failed:', e.message);
    }
  },

  /**
   * Full profile fetch — same endpoint, richer normalized shape.
   * Handles both legacy { id, name, gmailConnected } and the full
   * { settings, integrations, location, preferences } backend shape.
   * Returns a normalized activeProfile object or null.
   */
  getActiveProfile: async (mirrorId) => {
    const url = `${API_URL}/api/mirrors/active-user?mid=${encodeURIComponent(mirrorId)}`;
    try {
      console.log('[Profile] Polling:', url, '| mirrorId:', mirrorId);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn('[Profile] Poll failed — HTTP', res.status);
        return null;
      }
      const data = await res.json();
      const raw = data.profile || null;
      console.log('[Profile] Raw response:', raw);

      if (!raw) return null;

      const normalized = backendApi._normalizeProfile(raw);
      console.log('[Profile] Settings received:', normalized.settings);
      console.log('[Profile] Integrations received:', normalized.integrations);
      console.log('[Profile] Location received:', normalized.location);
      return normalized;
    } catch (err) {
      console.warn('[Profile] Poll error:', err.message);
      return null;
    }
  },

  // Normalizes both legacy and full backend profile shapes into one structure
  _normalizeProfile: (raw) => {
    const defaults = {
      settings: { datetime: true, weather: true, news: true, gmail: false, spotify: false },
      integrations: { gmail: { connected: false, email: null }, spotify: { connected: false } },
      location: { city: 'Istanbul', country: null, lat: null, lon: null },
      preferences: { units: 'celsius', newsSources: ['bbc', 'trt'], language: 'en' },
    };

    const gmailConnected = !!(
      raw.integrations?.gmail?.connected ?? raw.gmailConnected ?? false
    );
    const gmailEmail = raw.integrations?.gmail?.email || raw.gmailEmail || null;
    const spotifyConnected = !!(raw.integrations?.spotify?.connected ?? raw.spotifyConnected ?? false);

    return {
      profileId:  raw.id,
      name:       raw.name || null,
      settings: {
        ...defaults.settings,
        ...(raw.settings || {}),
        gmail:   gmailConnected,
        spotify: spotifyConnected,
      },
      integrations: {
        gmail:   { connected: gmailConnected, email: gmailEmail },
        spotify: { connected: spotifyConnected },
      },
      location: {
        city:    raw.location?.city    || defaults.location.city,
        country: raw.location?.country || null,
        lat:     raw.location?.lat     || null,
        lon:     raw.location?.lon     || null,
      },
      preferences: {
        units:       raw.preferences?.units       || defaults.preferences.units,
        newsSources: raw.preferences?.newsSources || defaults.preferences.newsSources,
        language:    raw.preferences?.language    || defaults.preferences.language,
      },
    };
  },
};

// Map backend profile shape → mirror profile shape
export const toMirrorProfile = (backendProfile) => ({
  id: String(backendProfile.id),
  name: backendProfile.name,
  source: 'backend',
  gmailConnected: !!(backendProfile.email && backendProfile.googleSub),
  gmailEmail: backendProfile.email || null,
  backendId: backendProfile.id,
});
