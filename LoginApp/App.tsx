import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import MainApp from './src/app/MainApp';
import {ServicesProvider} from './src/services';
import {appStore, hydrateAppStore, useApp} from './src/store/appStore';
import {startDemoPersistence} from './src/store/demoStore';

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
};

const LOGO_MARK = require('./assets/brand/logo-mark.png');

type BrandLogoProps = {
  size?: number;
  // Soft lime "orbit" halo around the tile, for hero placements on dark screens.
  glow?: boolean;
  borderColor?: string;
};

// PlugOrbit "P" mark on a white rounded tile, matching the launcher icon.
// The white tile keeps the logo's dark-navy stroke visible on dark backgrounds.
function BrandLogo({
  size = 40,
  glow = false,
  borderColor = 'rgba(255,255,255,0.9)',
}: BrandLogoProps): React.JSX.Element {
  const tile = (
    <View
      style={[
        styles.brandTile,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          padding: size * 0.14,
          borderColor,
        },
        glow && styles.brandTileGlow,
      ]}>
      <Image
        source={LOGO_MARK}
        style={styles.brandMark}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="PlugOrbit logo"
      />
    </View>
  );

  if (!glow) {
    return tile;
  }

  const haloSize = size * 1.5;
  return (
    <View
      style={[
        styles.brandHalo,
        {width: haloSize, height: haloSize, borderRadius: haloSize / 2},
      ]}>
      {tile}
    </View>
  );
}

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

  // Saved sign-in goes straight to the app; signing out returns to Welcome.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    setScreen(prev => (signedIn ? 'app' : prev === null || prev === 'app' ? 'welcome' : prev));
  }, [hydrated, signedIn]);

  // High-Contrast Theme Palette (WCAG AAA Compliant)
  const theme = {
    bg: '#060A12',           // Deep Obsidian Dark Background
    cardBg: '#111827',       // High Contrast Card Container
    accentLime: '#A2F067',   // Electric Lime Green Accent
    textWhite: '#FFFFFF',    // Pure White Primary Text
    textMuted: '#CBD5E1',    // Slate 200 High Contrast Subtext
    textPlaceholder: '#9CA3AF',
    inputBg: '#1F2937',      // Distinct Dark Input Field Background
    inputBorder: '#374151',  // Sharp High Contrast Borders
    secondaryBtnBg: '#111827',
    secondaryBtnBorder: '#374151',
  };

  if (screen === null) {
    return (
      <SafeAreaView style={[styles.safeArea, {backgroundColor: theme.bg}]}>
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
      <SafeAreaView style={[styles.safeArea, {backgroundColor: theme.bg}]}>
        <StatusBar barStyle="light-content" />

        <View style={styles.welcomeContainer}>
          {/* Header & Logo Section */}
          <View style={styles.headerSection}>
            <View style={styles.logoBadge}>
              <BrandLogo size={64} glow />
            </View>
            <Text style={styles.brandTitle}>PlugOrbit</Text>
            <Text style={styles.mainHeading}>Welcome to PlugOrbit</Text>
            <Text style={styles.tagline}>Charge Smarter. Travel Further.</Text>
          </View>

          {/* Clean EV Hero Image (without brand text / names) */}
          <View style={styles.illustrationCard}>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?q=80&w=1000&auto=format&fit=crop',
              }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          </View>

          {/* Carousel Pagination Dots */}
          <View style={styles.dotsRow}>
            <View style={[styles.dot, styles.activeDot]} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonGroup}>
            <Pressable
              style={({pressed}) => [
                styles.primaryBtn,
                pressed && {opacity: 0.88},
              ]}
              onPress={() => setScreen('signup')}>
              <Text style={styles.primaryBtnText}>Get Started</Text>
            </Pressable>

            <Pressable
              style={({pressed}) => [
                styles.secondaryBtn,
                pressed && {backgroundColor: '#1E293B'},
              ]}
              onPress={() => setScreen('login')}>
              <Text style={styles.secondaryBtnText}>
                I already have an account
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
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
  const otpInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // The in-flight "request", so it can be dropped if the user navigates away.
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = darkMode ? darkAuthTheme : lightAuthTheme;
  const isSignup = mode === 'signup';
  const identifierType = detectIdentifierType(identifier);

  const cancelPending = useCallback(() => {
    if (pendingRef.current !== null) {
      clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
  }, []);

  // Reset the flow whenever the user switches between Sign In and Sign Up, and
  // drop any in-flight request when that happens or when this screen goes away.
  useEffect(() => {
    setStep('identify');
    setOtp('');
    setResendIn(0);
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

  // TODO: replace the simulated delays below with calls to the backend OTP endpoints.
  const sendCode = () => {
    if (!identifierType) {
      Alert.alert(
        'Validation',
        'Please enter a valid mobile number or email address.',
      );
      return;
    }

    setLoading(true);
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      setLoading(false);
      setOtp('');
      setStep('verify');
      setResendIn(RESEND_SECONDS);
      Alert.alert(
        'Code Sent',
        `A ${OTP_LENGTH}-digit verification code has been sent to ${identifier.trim()}.`,
      );
    }, 1000);
  };

  const verifyCode = () => {
    if (otp.length !== OTP_LENGTH) {
      Alert.alert('Validation', `Please enter the ${OTP_LENGTH}-digit code.`);
      return;
    }

    setLoading(true);
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      setLoading(false);
      onAuthenticated();
    }, 1000);
  };

  const editIdentifier = () => {
    cancelPending();
    setLoading(false);
    setStep('identify');
    setOtp('');
    setResendIn(0);
  };

  const inputLabelBadge =
    identifierType === 'email'
      ? '✉️ Email'
      : identifierType === 'phone'
      ? '📱 Mobile'
      : '⚡ Auto-Detect';

  return (
    <SafeAreaView style={[styles.safeArea, {backgroundColor: t.bg}]}>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled">
          <Pressable style={styles.backButton} onPress={onBack}>
            <Text style={[styles.backButtonText, {color: t.primary}]}>
              ← Back
            </Text>
          </Pressable>

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
                      Mobile Number or Email ID
                    </Text>
                    <View
                      style={[
                        styles.detectBadge,
                        {backgroundColor: t.primarySoft, borderColor: t.cardBorder},
                      ]}>
                      <Text style={[styles.detectBadgeText, {color: t.primary}]}>
                        {inputLabelBadge}
                      </Text>
                    </View>
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

  welcomeContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 20 : 10,
    paddingBottom: 24,
  },

  headerSection: {
    alignItems: 'center',
    marginTop: 10,
  },

  logoBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },

  brandTile: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 3},
    elevation: 3,
  },

  brandTileGlow: {
    shadowColor: '#A2F067',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 0},
    elevation: 10,
  },

  brandMark: {
    width: '100%',
    height: '100%',
  },

  brandHalo: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(162, 240, 103, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(162, 240, 103, 0.28)',
  },

  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 16,
  },

  mainHeading: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  tagline: {
    fontSize: 15,
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: 6,
    fontWeight: '500',
  },

  illustrationCard: {
    flex: 1,
    maxHeight: 320,
    marginVertical: 20,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1.5,
    borderColor: '#374151',
  },

  heroImage: {
    width: '100%',
    height: '100%',
  },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#475569',
    marginHorizontal: 4,
  },

  activeDot: {
    width: 24,
    backgroundColor: '#A2F067',
  },

  buttonGroup: {
    gap: 12,
  },

  primaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#A2F067',
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '800',
  },

  secondaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#111827',
    borderWidth: 1.5,
    borderColor: '#374151',
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

  backButton: {
    marginBottom: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },

  backButtonText: {
    fontSize: 16,
    fontWeight: '700',
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
    fontSize: 14,
    fontWeight: '700',
  },

  detectBadge: {
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
