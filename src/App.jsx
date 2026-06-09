import React, { useState, useCallback, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SmartMirror from './pages/SmartMirror';
import Settings from './pages/Settings';
import Model from './pages/Model';
import ModelSettings from './pages/ModelSettings';
import PhonePair from './pages/PhonePair';
import Alerts from './pages/Alerts';
import PairingScreen from './components/PairingScreen';
import WelcomeScreen from './components/WelcomeScreen';
import SetupMode from './components/SetupMode';
import VirtualKeyboard from './components/VirtualKeyboard';
import { LanguageProvider } from './contexts/LanguageContext';
import { ProfileProvider } from './contexts/ProfileContext';
import { GuestModeProvider } from './contexts/GuestModeContext';
import { backendApi } from './services/backendApi';

// Flow: [SetupMode if offline] → 'pairing' → 'welcome' (3 s) → 'mirror'
function AppShell() {
  const [introPhase, setIntroPhase] = useState('pairing');
  // null = initial check in progress; true = no LAN IP yet; false = online
  const [isOffline, setIsOffline] = useState(null);

  const handlePairingComplete = useCallback(() => setIntroPhase('welcome'), []);
  const handleWelcomeDone     = useCallback(() => setIntroPhase('mirror'),  []);

  // Poll netinfo — show SetupMode until the Pi has a LAN IP.
  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const check = async () => {
      try {
        await backendApi.getNetInfo();
        if (!cancelled) {
          setIsOffline(false);
          clearInterval(timerId);
        }
      } catch {
        if (!cancelled) setIsOffline(v => (v === false ? false : true));
      }
    };

    check();
    timerId = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, []);

  // Brief connecting state — show a plain black screen to avoid a flash.
  if (isOffline === null) return <div className="fixed inset-0 bg-black" />;

  // Pi has no LAN IP yet — guide the customer through WiFi setup.
  if (isOffline) return <SetupMode />;

  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <div className="App">
        {/* Global on-screen keyboard — appears whenever a text field is focused,
            on every screen (pairing, mirror, settings). Typed via pinch-click. */}
        <VirtualKeyboard />
        {introPhase === 'pairing' && (
          <PairingScreen onComplete={handlePairingComplete} />
        )}
        {introPhase === 'welcome' && (
          <WelcomeScreen onDone={handleWelcomeDone} />
        )}
        {introPhase === 'mirror' && (
          <Routes>
            <Route path="/"              element={<SmartMirror />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="/model"         element={<Model />} />
            <Route path="/modelsettings" element={<ModelSettings />} />
          </Routes>
        )}
      </div>
    </Router>
  );
}

function App() {
  // /phone-pair is a standalone page for phones scanning the mirror QR code.
  // It runs outside the mirror's intro flow and doesn't need the mirror contexts.
  if (window.location.pathname === '/phone-pair') {
    return <PhonePair />;
  }

  // /alerts is the phone-side security alerts viewer — no mirror intro flow needed.
  if (window.location.pathname === '/alerts') {
    return <Alerts />;
  }

  return (
    <GuestModeProvider>
      <ProfileProvider>
        <LanguageProvider>
          <AppShell />
        </LanguageProvider>
      </ProfileProvider>
    </GuestModeProvider>
  );
}

export default App;
