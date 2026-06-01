import React, { useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SmartMirror from './pages/SmartMirror';
import Settings from './pages/Settings';
import Model from './pages/Model';
import ModelSettings from './pages/ModelSettings';
import PairingScreen from './components/PairingScreen';
import WelcomeScreen from './components/WelcomeScreen';
import { LanguageProvider } from './contexts/LanguageContext';
import { ProfileProvider } from './contexts/ProfileContext';
import { GuestModeProvider } from './contexts/GuestModeContext';

// Flow: 'pairing' → 'welcome' (3 s) → 'mirror'
function AppShell() {
  const [introPhase, setIntroPhase] = useState('pairing');

  const handlePairingComplete = useCallback(() => setIntroPhase('welcome'), []);
  const handleWelcomeDone     = useCallback(() => setIntroPhase('mirror'),  []);

  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <div className="App">
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
