import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { backendApi } from '../services/backendApi';
import { applyBackendSettings } from '../utils/applyBackendSettings';

// ── Default shape ─────────────────────────────────────────────────────────────
// Used while loading or when no backend profile exists.
// All widgets fall through to "show with defaults".
const DEFAULT_PROFILE = {
  profileId:    null,
  name:         null,
  settings: {
    datetime: true,
    weather:  true,
    news:     true,
    gmail:    false,
    spotify:  false,
  },
  integrations: {
    gmail:   { connected: false, email: null },
    spotify: { connected: false },
  },
  location: { city: 'Istanbul', country: null, lat: null, lon: null },
  preferences: { units: 'celsius', newsSources: ['bbc', 'trt'], language: 'en' },
};

const POLL_MS = 5000;

// ── Context ───────────────────────────────────────────────────────────────────
const ProfileContext = createContext({
  activeProfile: DEFAULT_PROFILE,
  isLoading:     true,
  lastSynced:    null,
  mirrorId:      null,
});

// ── Provider ──────────────────────────────────────────────────────────────────
export const ProfileProvider = ({ children }) => {
  const mirrorId                          = backendApi.getMirrorId();
  const [activeProfile, setActiveProfile] = useState(DEFAULT_PROFILE);
  const [isLoading, setIsLoading]         = useState(true);
  const [lastSynced, setLastSynced]       = useState(null);
  const prevProfileIdRef                  = useRef(null);
  const prevSettingsHashRef               = useRef(null);

  useEffect(() => {
    console.log('[ProfileContext] Mirror ID:', mirrorId);

    const poll = async () => {
      const profile = await backendApi.getActiveProfile(mirrorId);

      if (!profile) {
        // Backend unreachable or no active profile — keep defaults, stop loading
        setIsLoading(false);
        console.log('[ProfileContext] No profile returned — using defaults.');
        return;
      }

      // Detect settings changes even when profileId is unchanged
      const settingsHash = JSON.stringify(profile.settings);
      const settingsChanged = settingsHash !== prevSettingsHashRef.current;

      // Skip re-render when profile AND settings haven't changed
      if (
        profile.profileId === prevProfileIdRef.current &&
        !settingsChanged &&
        lastSynced !== null
      ) {
        console.log('[ProfileContext] Profile unchanged (id:', profile.profileId, ') — skip.');
        return;
      }

      prevProfileIdRef.current  = profile.profileId;
      prevSettingsHashRef.current = settingsHash;

      // Apply backend settings to localStorage so mirror widgets re-evaluate.
      // applyBackendSettings expects { widgets: { weather, news, ... } } (nested),
      // while profile.settings is the flat normalised object — wrap it accordingly.
      if (settingsChanged) {
        applyBackendSettings({ widgets: profile.settings });
      }

      setActiveProfile(profile);
      setLastSynced(Date.now());
      setIsLoading(false);

      console.log('[ProfileContext] Widget render decisions:', {
        datetime: profile.settings.datetime,
        weather:  profile.settings.weather,
        news:     profile.settings.news,
        gmail:    profile.integrations.gmail.connected,
        spotify:  profile.integrations.spotify.connected,
      });
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [mirrorId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ProfileContext.Provider value={{ activeProfile, isLoading, lastSynced, mirrorId }}>
      {children}
    </ProfileContext.Provider>
  );
};

// ── Consumer hook ─────────────────────────────────────────────────────────────
export const useProfile = () => useContext(ProfileContext);
