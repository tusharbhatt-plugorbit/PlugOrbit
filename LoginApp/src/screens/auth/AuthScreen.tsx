import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {OtpError, requestOtp, verifyOtp} from '../../services/otpApi';
import type {OtpSendResult} from '../../services/otpApi';
import {clearSession, saveSession} from '../../services/session';
import {colors, radii, sizes, spacing, type} from '../../theme';
import {BrandLogo} from '../../ui/BrandLogo';
import {PrimaryButton} from '../../ui/Buttons';
import {Icon} from '../../ui/Icon';
import {
  KeyboardAvoider,
  KeyboardAwareScrollView,
  notifyInputFocused,
} from '../../ui/KeyboardAware';
import {useKeyboardVisible} from '../../ui/useKeyboardVisible';
import {
  OTP_LENGTH,
  RESEND_SECONDS,
  authErrorMessage,
  codeProblem,
  detectIdentifierType,
  identifierProblem,
  isCodeRejection,
} from './authLogic';

type Step = 'identify' | 'verify';

type Props = {
  mode: 'login' | 'signup';
  onSwitchMode: () => void;
  onBack: () => void;
  onAuthenticated: () => void;
};

// Two looks for the form sheet, from theme tokens only. The hero above it is
// always the dark brand colour.
type FormTheme = {
  sheet: string;
  text: string;
  muted: string;
  subtle: string;
  field: string;
  fieldBorder: string;
  focus: string;
  danger: string;
  accent: string;
  accentSoft: string;
  button: 'dark' | 'lime';
  devBg: string;
  devBorder: string;
  devText: string;
  placeholder: string;
};

const LIGHT: FormTheme = {
  sheet: colors.surface,
  text: colors.ink,
  muted: colors.muted,
  subtle: colors.muted,
  field: colors.inputBg,
  fieldBorder: colors.inputBorder,
  focus: colors.limeDark,
  danger: colors.danger,
  accent: colors.limeDark,
  accentSoft: colors.limeSoft,
  button: 'dark',
  devBg: colors.amberSoft,
  devBorder: colors.amber,
  devText: colors.amber,
  placeholder: colors.placeholderOnLight,
};

const DARK: FormTheme = {
  sheet: colors.bgRaised,
  text: '#FFFFFF',
  muted: colors.chipText,
  subtle: colors.placeholder,
  field: colors.bg,
  fieldBorder: colors.chipBorder,
  focus: colors.lime,
  danger: colors.dangerOnDark,
  accent: colors.lime,
  accentSoft: colors.bg,
  button: 'lime',
  devBg: colors.bg,
  devBorder: colors.amberOnDark,
  devText: colors.amberOnDark,
  placeholder: colors.placeholder,
};

/**
 * Log in / sign up. PlugOrbit has no passwords: a one-time code goes to the
 * mobile number or email the person types, and the backend's /auth/otp/send and
 * /auth/otp/verify do the rest. This screen only presents that flow.
 */
export function AuthScreen({
  mode,
  onSwitchMode,
  onBack,
  onAuthenticated,
}: Props): React.JSX.Element {
  const [dark, setDark] = useState(false);
  const [step, setStep] = useState<Step>('identify');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  // How the current code was delivered ("Sent by" line or DEV banner).
  const [sendResult, setSendResult] = useState<OtpSendResult | null>(null);
  // One inline message at a time, under the field it is about.
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const keyboardVisible = useKeyboardVisible();
  const otpInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // The in-flight request, so it can be dropped if the user navigates away.
  const pendingRef = useRef<AbortController | null>(null);

  const t = dark ? DARK : LIGHT;
  const isSignup = mode === 'signup';
  const identifierType = detectIdentifierType(identifier);
  // On a short phone the hero gives its room to the form while typing.
  const tight = keyboardVisible && height < 760;

  const cancelPending = useCallback(() => {
    pendingRef.current?.abort();
    pendingRef.current = null;
  }, []);

  // Reset the flow whenever the user switches between Log in and Sign up, and
  // drop any in-flight request when that happens or when this screen goes away.
  useEffect(() => {
    setStep('identify');
    setOtp('');
    setResendIn(0);
    setSendResult(null);
    setError(null);
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
  // touch state, even if its response arrives later.
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
    const problem = identifierProblem(identifier);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

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
    } catch (e) {
      if (!request.isCurrent()) {
        return;
      }
      if (e instanceof OtpError && e.retryAfter && step === 'verify') {
        setResendIn(e.retryAfter);
      }
      setError(authErrorMessage(e));
    } finally {
      request.finish();
    }
  };

  const verifyCode = async () => {
    // A second tap must not cancel the first request and spend another attempt.
    if (loading) {
      return;
    }
    const problem = codeProblem(otp);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

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
      setError(
        isCodeRejection(e)
          ? authErrorMessage(e)
          : `Verification failed. ${authErrorMessage(e)}`,
      );
      setOtp('');
    } finally {
      request.finish();
    }
  };

  const editIdentifier = useCallback(() => {
    cancelPending();
    setLoading(false);
    setStep('identify');
    setOtp('');
    setResendIn(0);
    setSendResult(null);
    setError(null);
  }, [cancelPending]);

  // Android back: from the code step return to the number, otherwise leave.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'verify') {
        editIdentifier();
      } else {
        onBack();
      }
      return true;
    });
    return () => sub.remove();
  }, [step, editIdentifier, onBack]);

  // Shown on screen when the code could not be emailed or texted (dev only).
  const devCode = sendResult?.channel === 'screen' ? sendResult.devCode : null;
  const detectedLabel =
    identifierType === 'email'
      ? 'Email'
      : identifierType === 'phone'
      ? 'Mobile'
      : null;

  const title =
    step === 'verify'
      ? 'Enter your code'
      : isSignup
      ? 'Create your account'
      : 'Welcome back';
  const subtitle =
    step === 'verify'
      ? `We sent a ${OTP_LENGTH}-digit code to`
      : isSignup
      ? 'Use your mobile number or email. We’ll send a one-time code, so there’s no password to remember.'
      : 'Log in with your mobile number or email. We’ll send you a one-time code.';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoider>
        <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
          <View style={styles.topBar}>
            <Pressable
              onPress={onBack}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({pressed}) => [styles.iconBtn, pressed && styles.dim]}>
              <Icon name="arrow-left" size={24} color="#FFFFFF" />
            </Pressable>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{checked: dark}}
              accessibilityLabel="Toggle dark mode"
              onPress={() => setDark(d => !d)}
              hitSlop={8}
              style={({pressed}) => [styles.iconBtn, pressed && styles.dim]}>
              <Icon
                name={dark ? 'sun' : 'moon'}
                size={22}
                color={colors.chipText}
              />
            </Pressable>
          </View>

          <KeyboardAwareScrollView
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}>
            {tight ? (
              <View style={styles.heroTight}>
                <BrandLogo size={32} />
                <Text
                  style={styles.titleTight}
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.3}>
                  {title}
                </Text>
              </View>
            ) : (
              <View style={styles.hero}>
                <BrandLogo size={52} glow />
                <Text
                  style={styles.title}
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.3}>
                  {title}
                </Text>
                <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
                  {subtitle}
                </Text>
              </View>
            )}

            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: t.sheet,
                  paddingBottom:
                    Math.max(insets.bottom, spacing.xl) + spacing.md,
                },
              ]}>
              <View style={styles.column}>
                {step === 'identify' ? (
                  <>
                    <View style={styles.labelRow}>
                      <Text style={[styles.label, {color: t.text}]}>
                        Mobile number or email
                      </Text>
                      {detectedLabel && (
                        <View
                          style={[
                            styles.badge,
                            {backgroundColor: t.accentSoft},
                          ]}>
                          <Icon
                            name={
                              identifierType === 'email' ? 'mail' : 'smartphone'
                            }
                            size={12}
                            color={t.accent}
                            strokeWidth={2.4}
                          />
                          <Text style={[styles.badgeText, {color: t.accent}]}>
                            {detectedLabel}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View
                      style={[
                        styles.field,
                        {
                          backgroundColor: t.field,
                          borderColor: error
                            ? t.danger
                            : focused
                            ? t.focus
                            : t.fieldBorder,
                        },
                      ]}>
                      <Icon
                        name={
                          identifierType === 'email'
                            ? 'mail'
                            : identifierType === 'phone'
                            ? 'smartphone'
                            : 'user-round'
                        }
                        size={18}
                        color={t.subtle}
                      />
                      <TextInput
                        style={[styles.input, {color: t.text}]}
                        accessibilityLabel="Mobile number or email"
                        placeholder="name@example.com or +91…"
                        placeholderTextColor={t.placeholder}
                        underlineColorAndroid="transparent"
                        selectionColor={t.focus}
                        maxFontSizeMultiplier={1.3}
                        value={identifier}
                        onChangeText={v => {
                          setIdentifier(v);
                          setError(null);
                        }}
                        onFocus={() => {
                          setFocused(true);
                          notifyInputFocused();
                        }}
                        onBlur={() => setFocused(false)}
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
                    <Message text={error} color={t.danger} />

                    <PrimaryButton
                      label="Send verification code"
                      icon="arrow-right"
                      variant={t.button}
                      loading={loading}
                      loadingLabel="Sending code…"
                      onPress={sendCode}
                      style={styles.cta}
                    />
                    <Text style={[styles.hint, {color: t.muted}]}>
                      No password needed. We check it’s you with a one-time
                      code.
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={styles.sentTo}>
                      <Text
                        style={[styles.sentToText, {color: t.text}]}
                        numberOfLines={2}>
                        {identifier.trim()}
                      </Text>
                      <Pressable
                        onPress={editIdentifier}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Change number or email"
                        style={styles.changeBtn}>
                        <Text style={[styles.link, {color: t.accent}]}>
                          Change
                        </Text>
                      </Pressable>
                    </View>

                    {sendResult && sendResult.channel !== 'screen' ? (
                      <Text style={[styles.sentVia, {color: t.muted}]}>
                        {sendResult.channel === 'sms'
                          ? 'Sent by SMS'
                          : 'Sent by email'}
                      </Text>
                    ) : null}

                    {devCode ? (
                      <View
                        style={[
                          styles.dev,
                          {backgroundColor: t.devBg, borderColor: t.devBorder},
                        ]}>
                        <Text style={[styles.devLabel, {color: t.devText}]}>
                          DEV MODE
                        </Text>
                        <Text
                          selectable
                          style={[styles.devCode, {color: t.text}]}>
                          {`Your code is ${devCode}`}
                        </Text>
                        {sendResult?.viaLocalFallback ? (
                          <Text style={[styles.devNote, {color: t.muted}]}>
                            Backend unreachable, code generated on this device
                          </Text>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Tap to fill"
                          style={({pressed}) => [
                            styles.devFill,
                            {borderColor: t.devBorder},
                            pressed && styles.dim,
                          ]}
                          onPress={() => setOtp(devCode)}>
                          <Text
                            style={[styles.devFillText, {color: t.devText}]}>
                            Tap to fill
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {/* Six boxes, backed by one hidden input that owns the keyboard. */}
                    <Pressable
                      style={styles.otpRow}
                      onPress={() => otpInputRef.current?.focus()}>
                      {Array.from({length: OTP_LENGTH}).map((_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.otpBox,
                            {
                              backgroundColor: t.field,
                              borderColor: error
                                ? t.danger
                                : i === otp.length
                                ? t.focus
                                : t.fieldBorder,
                            },
                          ]}>
                          <Text style={[styles.otpDigit, {color: t.text}]}>
                            {otp[i] ?? ''}
                          </Text>
                        </View>
                      ))}
                      <TextInput
                        accessibilityLabel="Verification code"
                        caretHidden
                        ref={otpInputRef}
                        style={styles.hiddenInput}
                        value={otp}
                        onChangeText={value => {
                          setOtp(value.replace(/\D/g, '').slice(0, OTP_LENGTH));
                          setError(null);
                        }}
                        // The boxes and the Verify button under them come into view together.
                        onFocus={() =>
                          notifyInputFocused(null, sizes.button + spacing.xl)
                        }
                        returnKeyType="done"
                        onSubmitEditing={verifyCode}
                        keyboardType="number-pad"
                        textContentType="oneTimeCode"
                        autoComplete="sms-otp"
                        maxLength={OTP_LENGTH}
                        autoFocus
                      />
                    </Pressable>
                    <Message text={error} color={t.danger} />

                    <PrimaryButton
                      label={
                        isSignup
                          ? 'Verify and create account'
                          : 'Verify and log in'
                      }
                      icon="arrow-right"
                      variant={t.button}
                      loading={loading}
                      loadingLabel="Verifying…"
                      onPress={verifyCode}
                      style={styles.cta}
                    />

                    <View style={styles.resendRow}>
                      <Text style={[styles.small, {color: t.muted}]}>
                        Didn’t get the code?
                      </Text>
                      {resendIn > 0 ? (
                        <Text style={[styles.small, {color: t.subtle}]}>
                          {` Resend in ${resendIn}s`}
                        </Text>
                      ) : (
                        <Pressable
                          onPress={sendCode}
                          disabled={loading}
                          accessibilityRole="button"
                          accessibilityLabel="Resend code"
                          style={styles.changeBtn}>
                          <Text style={[styles.link, {color: t.accent}]}>
                            {' Resend code'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </>
                )}

                <View style={styles.switchRow}>
                  <Text style={[styles.small, {color: t.muted}]}>
                    {isSignup
                      ? 'Already have an account?'
                      : 'New to PlugOrbit?'}
                  </Text>
                  <Pressable
                    onPress={onSwitchMode}
                    accessibilityRole="button"
                    accessibilityLabel={isSignup ? 'Log in' : 'Create account'}
                    style={styles.changeBtn}>
                    <Text style={[styles.link, {color: t.accent}]}>
                      {isSignup ? ' Log in' : ' Create account'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </KeyboardAvoider>
    </View>
  );
}

/** An inline problem under a field. Announced to screen readers when it appears. */
function Message({text, color}: {text: string | null; color: string}) {
  if (!text) {
    return null;
  }
  return (
    <View
      style={styles.message}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      <Icon name="circle-alert" size={16} color={color} />
      <Text style={[styles.messageText, {color}]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  flex: {flex: 1},
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    height: sizes.tap + spacing.sm,
  },
  iconBtn: {
    width: sizes.tap,
    height: sizes.tap,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {opacity: 0.6},
  scroll: {flexGrow: 1},
  hero: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#CBD5E1',
    textAlign: 'center',
    maxWidth: 360,
  },
  heroTight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  titleTight: {...type.h1, color: '#FFFFFF', flexShrink: 1},
  sheet: {
    flexGrow: 1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  // Grows with the sheet so the account-switch row can sit at its bottom.
  column: {width: '100%', maxWidth: 480, alignSelf: 'center', flexGrow: 1},
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  label: {...type.bodyStrong, flexShrink: 1},
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {...type.micro, letterSpacing: 0.2},
  // One box, not a bare input: the border, the icon and the text share a single
  // row and a fixed minimum height, so nothing shifts while typing.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: sizes.field + 4,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderRadius: radii.md,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    paddingVertical: 0,
    // Android pads text for font ascent/descent, which sits it low in the box.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
  },
  messageText: {...type.label, flexShrink: 1, lineHeight: 18},
  cta: {marginTop: spacing.xl},
  hint: {...type.caption, textAlign: 'center', marginTop: spacing.md},
  sentTo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sentToText: {...type.heading, textAlign: 'center', flexShrink: 1},
  sentVia: {...type.caption, textAlign: 'center', marginTop: 2},
  changeBtn: {
    minHeight: sizes.tap,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  link: {...type.bodyStrong, fontWeight: '800'},
  dev: {
    borderWidth: 1.5,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  devLabel: {...type.micro},
  devCode: {...type.h1, marginTop: 4},
  devNote: {...type.caption, textAlign: 'center', marginTop: 4},
  devFill: {
    minHeight: sizes.tap,
    minWidth: 120,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devFillText: {...type.bodyStrong, fontWeight: '800'},
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: spacing.lg,
  },
  otpBox: {
    flex: 1,
    minWidth: 0,
    maxWidth: 56,
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: {fontSize: 22, fontWeight: '800'},
  hiddenInput: {...StyleSheet.absoluteFill, opacity: 0},
  resendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
  small: {...type.body},
});
