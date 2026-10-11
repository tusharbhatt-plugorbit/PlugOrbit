import React, {useEffect, useState} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import MainApp from './src/app/MainApp';
import {AuthScreen} from './src/screens/auth/AuthScreen';
import {OnboardingScreen} from './src/screens/auth/OnboardingScreen';
import {SplashScreen} from './src/screens/auth/SplashScreen';
import {WelcomeScreen} from './src/screens/auth/WelcomeScreen';
import {ServicesProvider} from './src/services';
import {startCloudSync} from './src/store/cloudSync';
import {appStore, hydrateAppStore, useApp} from './src/store/appStore';
import {startDemoPersistence} from './src/store/demoStore';
import {hasSeenOnboarding, markOnboardingSeen} from './src/store/onboarding';

type Screen = 'welcome' | 'onboarding' | 'login' | 'signup' | 'app';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <AppContent />
      </ServicesProvider>
    </SafeAreaProvider>
  );
}

function AppContent(): React.JSX.Element {
  // null while saved state loads, so a signed-in user never flashes the Welcome screen.
  const [screen, setScreen] = useState<Screen | null>(null);
  // null until read; treated as "not seen", which only ever shows the intro once more.
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);
  const hydrated = useApp(st => st.hydrated);
  const signedIn = useApp(st => st.signedIn);

  useEffect(() => {
    startDemoPersistence();
    hydrateAppStore();
    hasSeenOnboarding().then(setIntroSeen);
  }, []);

  // Cloud backup runs while signed in (it does nothing without a cloud session). It is
  // not stopped here when signedIn flips to false: signing out goes through
  // endCloudSession(), which gives pending edits one last upload before stopping.
  useEffect(() => {
    if (hydrated && signedIn) {
      startCloudSync();
    }
  }, [hydrated, signedIn]);

  // Saved sign-in goes straight to the app; signing out returns to Welcome.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    setScreen(prev =>
      signedIn ? 'app' : prev === null || prev === 'app' ? 'welcome' : prev,
    );
  }, [hydrated, signedIn]);

  if (screen === null) {
    return <SplashScreen />;
  }

  // --- SIGNED-IN APP (tabs, stack, vehicle setup, session recovery) ---
  if (screen === 'app') {
    return <MainApp />;
  }

  // --- WELCOME ---
  if (screen === 'welcome') {
    return (
      <WelcomeScreen
        // The introduction shows once per install; "Log in" never waits for it.
        onGetStarted={() => setScreen(introSeen ? 'signup' : 'onboarding')}
        onLogIn={() => setScreen('login')}
      />
    );
  }

  // --- FIRST-RUN INTRODUCTION (3 slides, skippable) ---
  if (screen === 'onboarding') {
    return (
      <OnboardingScreen
        onDone={() => {
          setIntroSeen(true);
          markOnboardingSeen();
          setScreen('signup');
        }}
        onBack={() => setScreen('welcome')}
      />
    );
  }

  // --- LOG IN / SIGN UP (one-time code) ---
  return (
    <AuthScreen
      mode={screen}
      onSwitchMode={() => setScreen(screen === 'login' ? 'signup' : 'login')}
      onBack={() => setScreen('welcome')}
      onAuthenticated={() => appStore.set({signedIn: true})}
    />
  );
}

export default App;
