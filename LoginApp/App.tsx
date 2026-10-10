import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import MainApp from './src/app/MainApp';
import {ServicesProvider} from './src/services';
import {OtpError, requestOtp, verifyOtp} from './src/services/otpApi';
import {clearSession, saveSession} from './src/services/session';
import {startCloudSync} from './src/store/cloudSync';
import type {OtpSendResult} from './src/services/otpApi';
import {appStore, hydrateAppStore, useApp} from './src/store/appStore';
import {startDemoPersistence} from './src/store/demoStore';
import {BrandLogo} from './src/ui/BrandLogo';
import {Icon} from './src/ui/Icon';
import {WelcomeBackdrop} from './src/ui/WelcomeBackdrop';

type Screen = 'welcome' | 'login' | 'signup' | 'app';
type AuthStep = 'identify' | 'verify';
type IdentifierType = 'email' | 'phone' | null;

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Decide whether the user typed an email address or a mobile number.
function detectIdentifierType(value: string): IdentifierType {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes('@')) {
    return EMAIL_REGEX.test(trimmed) ? 'email' : null;
  }
  if (/^\+?[\d\s()-]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? 'phone' : null;
  }
  return null;
}

function errorMessage(e: unknown): string {
  return e instanceof OtpError
    ? e.message
    : 'Something went wrong. Please try again.';
}

const lightAuthTheme = {
  bg: '#F6F8FB',
  cardBg: '#FFFFFF',
  cardBorder: '#D7EDE3',
  primary: '#0B9467',
  primarySoft: '#E7F7F0',
  text: '#0F172A',
  textMuted: '#475569',
  textSubtle: '#94A3B8',
  inputBg: '#EEF2F7',
  inputBorder: '#D5DDE8',
  divider: '#E2E8F0',
  buttonText: '#FFFFFF',
  // DEV code banner (amber, so it never reads as a success state).
  devBg: '#FFF7E6',
  devBorder: '#F59E0B',
  devText: '#92400E',
};

const darkAuthTheme: typeof lightAuthTheme = {
  bg: '#060A12',
  cardBg: '#111827',
  cardBorder: '#374151',
  primary: '#A2F067',
  primarySoft: '#1A2A14',
  text: '#FFFFFF',
  textMuted: '#CBD5E1',
  textSubtle: '#9CA3AF',
  inputBg: '#1F2937',
  inputBorder: '#374151',
  divider: '#1F2937',
  buttonText: '#000000',
  devBg: '#2A1F0A',
  devBorder: '#F59E0B',
  devText: '#FCD34D',
};

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
  const hydrated = useApp(st => st.hydrated);
  const signedIn = useApp(st => st.signedIn);

  useEffect(() => {
    startDemoPersistence();
    hydrateAppStore();
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
    setScreen(prev => (signedIn ? 'app' : prev === null || prev === 'app' ? 'welcome' : prev));
  }, [hydrated, signedIn]);

  if (screen === null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <View style={styles.splash}>
          <BrandLogo size={64} glow />
        </View>
      </SafeAreaView>
    );
  }

  // --- SIGNED-IN APP (tabs, stack, onboarding, session recovery) ---
  if (screen === 'app') {
    return <MainApp />;
  }

  // --- WELCOME / LANDING SCREEN ---
  if (screen === 'welcome') {
    return (
      <Welcome
        onGetStarted={() => setScreen('signup')}
        onSignIn={() => setScreen('login')}
      />
    );
  }

  // --- LOGIN / SIGNUP SCREEN (OTP based) ---
  return (
    <AuthScreen
      mode={screen}
      onSwitchMode={() => setScreen(screen === 'login' ? 'signup' : 'login')}
      onBack={() => setScreen('welcome')}
      onAuthenticated={() => appStore.set({signedIn: true})}
    />
  );
}

type WelcomeProps = {
  onGetStarted: () => void;
  onSignIn: () => void;
};

// First screen: PlugOrbit -> what it does -> one obvious action.
function Welcome({onGetStarted, onSignIn}: WelcomeProps): React.JSX.Element {
  const {height, fontScale} = useWindowDimensions();
  // Short phones, or large system text, get a smaller mark so the copy and both
  // buttons fit; the road scene only draws where it clears the copy.
  const compact = height < 700 || fontScale > 1.3;
  const logoSize = compact ? 56 : 72;
  const ring = logoSize * 1.5;

  return (
    <View style={styles.welcomeRoot}>
      <StatusBar barStyle="light-content" />
      <WelcomeBackdrop showRoad={height >= 640} showCharger={!compact} />
      <SafeAreaView style={styles.flex}>
        {/* Scrolls only when text is scaled up past what fits. */}
        <ScrollView
          contentContainerStyle={styles.welcomeContainer}
          bounces={false}
          showsVerticalScrollIndicator={false}>
          <View style={styles.welcomeTop}>
            {/* Orbit rings round the mark: the brand idea, kept faint. */}
            <View
              style={[
                styles.orbitRing,
                {width: ring * 1.9, height: ring * 1.9, borderRadius: ring},
              ]}>
              <View
                style={[
                  styles.orbitRingInner,
                  {width: ring * 1.35, height: ring * 1.35, borderRadius: ring},
                ]}>
                <BrandLogo size={logoSize} glow />
              </View>
            </View>
            <Text style={styles.brandTitle}>PlugOrbit</Text>
            <Text
              style={[styles.headline, compact && styles.headlineCompact]}
              accessibilityRole="header">
              {'Charge Smarter.\nTravel Further.'}
            </Text>
            <Text style={styles.support}>
              Find a charger that fits your car, get there, and start charging.
            </Text>
          </View>

          <View style={styles.buttonGroup}>
            <Pressable
              accessibilityRole="button"
              style={({pressed}) => [
                styles.primaryBtn,
                pressed && {opacity: 0.88},
              ]}
              onPress={onGetStarted}>
              <Text style={styles.primaryBtnText}>Get Started</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={({pressed}) => [
                styles.secondaryBtn,
                pressed && {backgroundColor: 'rgba(255,255,255,0.08)'},
              ]}
              onPress={onSignIn}>
              <Text style={styles.secondaryBtnText}>
                I already have an account
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

type AuthScreenProps = {
  mode: 'login' | 'signup';
  onSwitchMode: () => void;
  onBack: () => void;
  onAuthenticated: () => void;
};

function AuthScreen({mode, onSwitchMode, onBack, onAuthenticated}: AuthScreenProps): React.JSX.Element {
  const [darkMode, setDarkMode] = useState(false);
  const [step, setStep] = useState<AuthStep>('identify');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  // How the current code was delivered ("Sent by" line or DEV banner).
  const [sendResult, setSendResult] = useState<OtpSendResult | null>(null);
  const otpInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // The in-flight request, so it can be dropped if the user navigates away.
  const pendingRef = useRef<AbortController | null>(null);

  const t = darkMode ? darkAuthTheme : lightAuthTheme;
  const isSignup = mode === 'signup';
  const identifierType = detectIdentifierType(identifier);

  const cancelPending = useCallback(() => {
    pendingRef.current?.abort();
    pendingRef.current = null;
  }, []);

  // Reset the flow whenever the user switches between Sign In and Sign Up, and
  // drop any in-flight request when that happens or when this screen goes away.
  useEffect(() => {
    setStep('identify');
    setOtp('');
    setResendIn(0);
    setSendResult(null);
    setLoading(false);
    return cancelPending;
  }, [mode, cancelPending]);

  // Countdown for the "Resend code" link.
  useEffect(() => {
    if (resendIn <= 0) {
      return;
    }
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Starts a request and returns its abort signal plus a check for "still the
  // current request". A dropped request (Back, Change, mode switch) must never
  // touch state or raise an Alert, even if its response arrives later.
  const beginRequest = () => {
    cancelPending();
    const controller = new AbortController();
    pendingRef.current = controller;
    setLoading(true);
    return {
      signal: controller.signal,
      isCurrent: () => pendingRef.current === controller,
      finish: () => {
        if (pendingRef.current === controller) {
          pendingRef.current = null;
          setLoading(false);
        }
      },
    };
  };

  const sendCode = async () => {
    // The keyboard's send key is not disabled while a request is in flight.
    if (loading) {
      return;
    }
    if (!identifierType) {
      Alert.alert(
        'Validation',
        'Please enter a valid mobile number or email address.',
      );
      return;
    }

    const target = identifier.trim();
    const request = beginRequest();
    try {
      const result = await requestOtp(target, request.signal);
      if (!request.isCurrent()) {
        return;
      }
      setOtp('');
      setStep('verify');
      setSendResult(result);
      setResendIn(
        Number.isFinite(result.resendIn) ? result.resendIn : RESEND_SECONDS,
      );
      if (result.channel === 'screen' && result.devCode) {
        Alert.alert(
          'Dev Code',
          `Your code is ${result.devCode}. It was not sent by email or SMS (development mode).`,
        );
      } else {
        Alert.alert(
          'Code Sent',
          `A ${OTP_LENGTH}-digit verification code has been sent to ${target}.`,
        );
      }
    } catch (e) {
      if (!request.isCurrent()) {
        return;
      }
      if (e instanceof OtpError && e.retryAfter && step === 'verify') {
        setResendIn(e.retryAfter);
      }
      Alert.alert('Could not send code', errorMessage(e));
    } finally {
      request.finish();
    }
  };

  const verifyCode = async () => {
    if (otp.length !== OTP_LENGTH) {
      Alert.alert('Validation', `Please enter the ${OTP_LENGTH}-digit code.`);
      return;
    }

    const request = beginRequest();
    try {
      const session = await verifyOtp(identifier.trim(), otp, request.signal);
      if (!request.isCurrent()) {
        return;
      }
      // Keep the cloud session (or drop a stale one) before the app starts using it.
      if (session) {
        await saveSession(session);
      } else {
        await clearSession();
      }
      onAuthenticated();
    } catch (e) {
      if (!request.isCurrent()) {
        return;
      }
      const rejected =
        e instanceof OtpError &&
        (e.code === 'OTP_INVALID' ||
          e.code === 'OTP_EXPIRED' ||
          e.code === 'OTP_TOO_MANY_ATTEMPTS');
      Alert.alert(
        rejected ? 'Invalid Code' : 'Verification Failed',
        errorMessage(e),
      );
      setOtp('');
    } finally {
      request.finish();
    }
  };

  const editIdentifier = () => {
    cancelPending();
    setLoading(false);
    setStep('identify');
    setOtp('');
    setResendIn(0);
    setSendResult(null);
  };

  // Shown on screen when the code could not be emailed or texted (dev only).
  const devCode =
    sendResult?.channel === 'screen' ? sendResult.devCode : null;

  const detectedLabel =
    identifierType === 'email'
      ? 'Email'
      : identifierType === 'phone'
      ? 'Mobile'
      : null;

  return (
    <SafeAreaView style={[styles.safeArea, {backgroundColor: t.bg}]}>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />

      {/* Sign in / sign up are reached from Welcome, so one arrow goes back. */}
      <View style={styles.authTopBar}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({pressed}) => [styles.backArrow, pressed && {opacity: 0.6}]}>
          <Icon name="arrow-left" size={24} color={t.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled">
          <View
            style={[
              styles.authCard,
              {backgroundColor: t.cardBg, borderColor: t.cardBorder},
            ]}>
            {/* Logo & Theme Toggle */}
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardBrand}>
                <BrandLogo size={40} borderColor={t.cardBorder} />
                <Text style={[styles.cardBrandText, {color: t.text}]}>
                  PlugOrbit
                </Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{checked: darkMode}}
                accessibilityLabel="Toggle dark mode"
                onPress={() => setDarkMode(!darkMode)}
                style={[
                  styles.themeToggle,
                  {backgroundColor: t.cardBg, borderColor: t.inputBorder},
                ]}>
                <Text
                  style={[
                    styles.themeToggleIcon,
                    darkMode && styles.themeToggleIconRight,
                  ]}>
                  {darkMode ? '☀️' : '🌙'}
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.authTitle, {color: t.text}]}>
              {step === 'verify'
                ? 'Verify Code'
                : isSignup
                ? 'Create Account'
                : 'Welcome Back'}
            </Text>

            <Text style={[styles.authSubtitle, {color: t.textMuted}]}>
              {step === 'verify'
                ? `Enter the ${OTP_LENGTH}-digit code we sent to`
                : isSignup
                ? 'Join PlugOrbit to connect to 50k+ supercharging stations.'
                : 'Sign in to continue charging smarter with PlugOrbit.'}
            </Text>

            {step === 'identify' ? (
              <>
                {/* Google Sign-In */}
                <Pressable
                  style={({pressed}) => [
                    styles.googleBtn,
                    {backgroundColor: t.cardBg, borderColor: t.inputBorder},
                    pressed && {opacity: 0.85},
                  ]}
                  onPress={() =>
                    Alert.alert('Google', 'Google sign-in is coming soon.')
                  }>
                  <View style={styles.googleIcon}>
                    <Text style={styles.googleIconText}>G</Text>
                  </View>
                  <Text style={[styles.googleBtnText, {color: t.text}]}>
                    {isSignup ? 'Sign Up with Google' : 'Sign In with Google'}
                  </Text>
                </Pressable>

                {/* Divider */}
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, {backgroundColor: t.divider}]} />
                  <Text style={[styles.dividerText, {color: t.textSubtle}]}>
                    OR CONTINUE WITH
                  </Text>
                  <View style={[styles.dividerLine, {backgroundColor: t.divider}]} />
                </View>

                {/* Mobile Number or Email Input */}
                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.label, {color: t.text}]}>
                      Mobile number or email
                    </Text>
                    {detectedLabel && (
                      <View
                        style={[
                          styles.detectBadge,
                          {
                            backgroundColor: t.primarySoft,
                            borderColor: t.cardBorder,
                          },
                        ]}>
                        <Icon
                          name={identifierType === 'email' ? 'mail' : 'smartphone'}
                          size={12}
                          color={t.primary}
                          strokeWidth={2.4}
                        />
                        <Text
                          style={[styles.detectBadgeText, {color: t.primary}]}>
                          {detectedLabel}
                        </Text>
                      </View>
                    )}
                  </View>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: t.inputBg,
                        borderColor: t.inputBorder,
                        color: t.text,
                      },
                    ]}
                    placeholder="e.g. +91 98765 43210 or name@example.com"
                    placeholderTextColor={t.textSubtle}
                    value={identifier}
                    onChangeText={setIdentifier}
                    // Kept fixed: a numeric-looking prefix can still become an
                    // email (e.g. 9876543210@gmail.com), and phone-pad has no "@".
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="send"
                    onSubmitEditing={sendCode}
                    // Locked while a code is being sent, so the verify step can
                    // never show a different identifier than the one it went to.
                    editable={!loading}
                  />
                </View>

                <Pressable
                  style={({pressed}) => [
                    styles.authPrimaryBtn,
                    {backgroundColor: t.primary},
                    (pressed || loading) && {opacity: 0.85},
                  ]}
                  onPress={sendCode}
                  disabled={loading}>
                  <Text style={[styles.authPrimaryBtnText, {color: t.buttonText}]}>
                    {loading ? 'Sending...' : 'Send Verification Code  →'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* Where the code was sent */}
                <View style={styles.sentToRow}>
                  <Text style={[styles.sentToText, {color: t.text}]}>
                    {identifier.trim()}
                  </Text>
                  <Pressable onPress={editIdentifier}>
                    <Text style={[styles.linkText, {color: t.primary}]}>
                      {'  Change'}
                    </Text>
                  </Pressable>
                </View>

                {/* How the code was delivered */}
                {sendResult && sendResult.channel !== 'screen' ? (
                  <Text style={[styles.sentViaText, {color: t.textMuted}]}>
                    {sendResult.channel === 'sms'
                      ? 'Sent by SMS'
                      : 'Sent by email'}
                  </Text>
                ) : null}
                {devCode ? (
                  <View
                    style={[
                      styles.devBanner,
                      {backgroundColor: t.devBg, borderColor: t.devBorder},
                    ]}>
                    <Text style={[styles.devBannerLabel, {color: t.devText}]}>
                      DEV MODE
                    </Text>
                    <Text
                      selectable
                      style={[styles.devBannerCode, {color: t.text}]}>
                      {`Your code is ${devCode}`}
                    </Text>
                    {sendResult?.viaLocalFallback ? (
                      <Text
                        style={[styles.devBannerNote, {color: t.textMuted}]}>
                        Backend unreachable, code generated on this device
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      style={({pressed}) => [
                        styles.devFillBtn,
                        {borderColor: t.devBorder},
                        pressed && {opacity: 0.85},
                      ]}
                      onPress={() => setOtp(devCode)}>
                      <Text style={[styles.devFillBtnText, {color: t.devText}]}>
                        Tap to fill
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                {/* OTP Boxes (backed by a single hidden input) */}
                <Pressable
                  style={styles.otpRow}
                  onPress={() => otpInputRef.current?.focus()}>
                  {Array.from({length: OTP_LENGTH}).map((_, i) => {
                    const isActive = i === otp.length;
                    return (
                      <View
                        key={i}
                        style={[
                          styles.otpBox,
                          {
                            backgroundColor: t.inputBg,
                            borderColor: isActive ? t.primary : t.inputBorder,
                          },
                        ]}>
                        <Text style={[styles.otpDigit, {color: t.text}]}>
                          {otp[i] ?? ''}
                        </Text>
                      </View>
                    );
                  })}
                </Pressable>
                <TextInput
                  ref={otpInputRef}
                  style={styles.hiddenInput}
                  value={otp}
                  onChangeText={value =>
                    setOtp(value.replace(/\D/g, '').slice(0, OTP_LENGTH))
                  }
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={OTP_LENGTH}
                  autoFocus
                />

                <Pressable
                  style={({pressed}) => [
                    styles.authPrimaryBtn,
                    {backgroundColor: t.primary},
                    (pressed || loading) && {opacity: 0.85},
                  ]}
                  onPress={verifyCode}
                  disabled={loading}>
                  <Text style={[styles.authPrimaryBtnText, {color: t.buttonText}]}>
                    {loading
                      ? 'Verifying...'
                      : isSignup
                      ? 'Verify & Create Account  →'
                      : 'Verify & Sign In  →'}
                  </Text>
                </Pressable>

                <View style={styles.resendRow}>
                  <Text style={[styles.switchText, {color: t.textMuted}]}>
                    Didn't receive the code?
                  </Text>
                  {resendIn > 0 ? (
                    <Text style={[styles.switchText, {color: t.textSubtle}]}>
                      {` Resend in ${resendIn}s`}
                    </Text>
                  ) : (
                    <Pressable onPress={sendCode} disabled={loading}>
                      <Text style={[styles.linkText, {color: t.primary}]}>
                        {' Resend'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}

            {/* Switch Login/Signup */}
            <View style={styles.switchRow}>
              <Text style={[styles.switchText, {color: t.textMuted}]}>
                {isSignup ? 'Already have an account?' : "Don't have an account?"}
              </Text>
              <Pressable onPress={onSwitchMode}>
                <Text style={[styles.linkText, {color: t.primary}]}>
                  {isSignup ? ' Sign In' : ' Sign Up'}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#060A12',
  },

  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  flex: {
    flex: 1,
  },

  // Welcome
  welcomeRoot: {
    flex: 1,
    backgroundColor: '#060A12',
  },

  welcomeContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    justifyContent: 'space-between',
    // Wide tablets: keep the column phone-sized and centred.
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },

  welcomeTop: {
    alignItems: 'center',
  },

  orbitRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(162, 240, 103, 0.10)',
    marginBottom: 4,
  },

  orbitRingInner: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(162, 240, 103, 0.18)',
  },

  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  headline: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 20,
  },

  headlineCompact: {
    fontSize: 26,
    lineHeight: 32,
    marginTop: 12,
  },

  support: {
    fontSize: 16,
    lineHeight: 23,
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
  },

  buttonGroup: {
    gap: 12,
  },

  primaryBtn: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: '#A2F067',
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryBtnText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '800',
  },

  secondaryBtn: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(203, 213, 225, 0.35)',
    backgroundColor: 'rgba(6, 10, 18, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Auth Screen Styles
  authScroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'center',
  },

  authTopBar: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },

  // 44pt target; its icon lines up with the card's left edge.
  backArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  authCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    shadowColor: '#0B9467',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 8},
    elevation: 4,
  },

  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },

  cardBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  cardBrandText: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  themeToggle: {
    width: 58,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },

  themeToggleIcon: {
    fontSize: 13,
  },

  themeToggleIconRight: {
    alignSelf: 'flex-end',
  },

  authTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },

  authSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },

  googleBtn: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  googleIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4285F4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  googleIconText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },

  googleBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },

  dividerLine: {
    flex: 1,
    height: 1,
  },

  dividerText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginHorizontal: 10,
  },

  inputGroup: {
    marginBottom: 20,
  },

  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },

  label: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
  },

  detectBadge: {
    flexShrink: 0,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  detectBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  input: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },

  authPrimaryBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  authPrimaryBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },

  sentToRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: -12,
    marginBottom: 20,
  },

  sentToText: {
    fontSize: 14,
    fontWeight: '700',
  },

  sentViaText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: -14,
    marginBottom: 20,
  },

  devBanner: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    alignItems: 'center',
  },

  devBannerLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },

  devBannerCode: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },

  devBannerNote: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },

  devFillBtn: {
    minHeight: 44,
    minWidth: 120,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 16,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  devFillBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },

  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },

  otpBox: {
    width: 44,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  otpDigit: {
    fontSize: 20,
    fontWeight: '800',
  },

  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },

  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },

  switchText: {
    fontSize: 14,
  },

  linkText: {
    fontSize: 14,
    fontWeight: '800',
  },
});

export default App;
