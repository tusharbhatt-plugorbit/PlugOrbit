import {useAppearance,useThemedStyles} from '../appearance';
import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  AssistantAction,
  AssistantPhase,
  ChatMessage,
  FallbackLink,
  PermissionState,
  SourceInfo,
} from '../assistant/types';
import {
  colors,
  elevation,
  radii,
  sizes,
  slopFor,
  spacing,
  type,
} from '../theme';
import {PrimaryButton, SecondaryButton} from './Buttons';
import {Icon, IconName} from './Icon';
import {useReducedMotion} from './useReducedMotion';

/**
 * Orbit Assist's conversation pieces. Presentational: they take state and
 * callbacks, so the full screen, the bottom sheet and driving mode share them.
 */

// -------------------------------------------------------------------- orb ---

const PHASE_ICON: Record<AssistantPhase, IconName> = {
  idle: 'sparkles',
  listening: 'mic',
  thinking: 'sparkles',
  speaking: 'volume2',
  error: 'triangle-alert',
};

export const PHASE_WORDS: Record<AssistantPhase, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Checking',
  speaking: 'Speaking',
  error: 'Something went wrong',
};

/**
 * The listening indicator. Rings pulse with the driver's voice while listening,
 * an arc turns while thinking, bars move while speaking. With reduced motion it
 * is a still disc and the words carry the state.
 */
export function VoiceOrb({
  phase,
  level = 0,
  size = 128,
}: {
  phase: AssistantPhase;
  level?: number;
  size?: number;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const voice = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced || phase === 'idle' || phase === 'error') {
      return;
    }
    const anim =
      phase === 'thinking'
        ? Animated.loop(
            Animated.timing(spin, {
              toValue: 1,
              duration: 1100,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
          )
        : Animated.loop(
            Animated.timing(pulse, {
              toValue: 1,
              duration: phase === 'listening' ? 1300 : 900,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          );
    pulse.setValue(0);
    spin.setValue(0);
    anim.start();
    return () => anim.stop();
  }, [phase, reduced, pulse, spin]);

  useEffect(() => {
    if (reduced) {
      return;
    }
    Animated.timing(voice, {
      toValue: level,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [level, reduced, voice]);

  const core = size * 0.56;
  const ring = (i: number) => {
    const delay = i * 0.33;
    const scale = pulse.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.7],
    });
    const opacity = pulse.interpolate({
      inputRange: [0, 0.2 + delay / 2, 1],
      outputRange: [0.0, 0.32, 0],
    });
    return (
      <Animated.View
        key={i}
        style={[
          styles.ring,
          {
            width: core,
            height: core,
            borderRadius: core / 2,
            opacity,
            transform: [{scale}],
          },
        ]}
      />
    );
  };
  const coreScale = voice.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });
  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const showRings = !reduced && (phase === 'listening' || phase === 'speaking');

  return (
    <View
      style={[styles.orb, {width: size, height: size}]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Orbit Assist is ${PHASE_WORDS[phase].toLowerCase()}`}
      testID="voice-orb">
      {showRings && [0, 1, 2].map(ring)}
      {phase === 'thinking' && !reduced && (
        <Animated.View
          style={[
            styles.arc,
            {
              width: core + 14,
              height: core + 14,
              borderRadius: (core + 14) / 2,
              transform: [{rotate}],
            },
          ]}
        />
      )}
      <Animated.View
        style={[
          styles.core,
          {
            width: core,
            height: core,
            borderRadius: core / 2,
            transform: [{scale: coreScale}],
          },
          phase === 'error' && styles.coreError,
        ]}>
        <Icon
          name={PHASE_ICON[phase]}
          size={core * 0.42}
          color={phase === 'error' ? colors.danger : colors.ink}
        />
      </Animated.View>
    </View>
  );
}

// ------------------------------------------------------------- mic buttons ---

export function MicButton({
  phase,
  onPress,
  disabled,
  size = 72,
  label,
}: {
  phase: AssistantPhase;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  label?: string;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const listening = phase === 'listening';
  const busy = phase === 'thinking' || phase === 'speaking';
  const text =
    label ??
    (disabled
      ? 'Microphone not available'
      : listening
      ? 'Stop listening and send'
      : busy
      ? 'Interrupt and talk'
      : 'Tap to talk to Orbit');
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{disabled: !!disabled, selected: listening}}
      testID="mic-button"
      style={({pressed}) => [
        styles.mic,
        elevation(2),
        {width: size, height: size, borderRadius: size / 2},
        listening && styles.micLive,
        disabled && styles.micDisabled,
        pressed && !disabled && {opacity: 0.88},
      ]}>
      <Icon
        name={disabled ? 'mic-off' : listening ? 'circle-stop' : 'mic'}
        size={size * 0.42}
        color={listening ? colors.surface : colors.ink}
        filled={false}
      />
    </Pressable>
  );
}

export function RoundAction({
  icon,
  label,
  onPress,
  active,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: !!active, disabled: !!disabled}}
      hitSlop={slopFor(44)}
      style={({pressed}) => [
        styles.round,
        active && styles.roundActive,
        disabled && {opacity: 0.4},
        pressed && {opacity: 0.8},
      ]}>
      <Icon
        name={icon}
        size={20}
        color={active ? colors.ink : colors.chipText}
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------- messages ---

const SOURCE_WORDS: Record<string, string> = {
  deterministic_engine: 'the trip planner',
  device_store: 'your saved details',
  device_gps: 'your location',
  sample_data: 'sample charger data',
};

/** "Based on the trip planner and sample charger data. Preview data." or null. */
export function sourceLine(sources: SourceInfo[] | undefined): string | null {
  if (!sources || sources.length === 0) {
    return null;
  }
  const kinds = Array.from(
    new Set(
      sources
        .map(s => (s.kind ? SOURCE_WORDS[s.kind] : undefined))
        .filter((x): x is string => !!x),
    ),
  );
  const demo = sources.some(s => s.demo);
  const missing = sources.filter(s => s.status !== 'ok').length;
  const parts: string[] = [];
  if (kinds.length > 0) {
    parts.push(`Based on ${kinds.join(' and ')}.`);
  }
  if (demo) {
    parts.push('Preview data.');
  }
  if (missing > 0) {
    parts.push(`${missing} check${missing > 1 ? 's' : ''} had no answer.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function Dots() {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const reduced = useReducedMotion();
  const a = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    if (reduced) {
      a.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, {toValue: 1, duration: 450, useNativeDriver: true}),
        Animated.timing(a, {
          toValue: 0.3,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a, reduced]);
  return <Animated.Text style={[styles.dots, {opacity: a}]}>…</Animated.Text>;
}

const LEVEL_WORDS = {
  info: 'Orbit noticed',
  action: 'Coming up',
  important: 'Plan changed',
  critical: 'Needs attention',
} as const;

export function MessageBubble({
  message,
  onReplay,
  canReplay,
  speaking,
  large,
}: {
  message: ChatMessage;
  onReplay?: () => void;
  canReplay?: boolean;
  speaking?: boolean;
  /** Driving mode: bigger type. */
  large?: boolean;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={[styles.userText, large && styles.largeText]}>
            {message.text}
          </Text>
        </View>
        {message.via === 'voice' && (
          <Text style={styles.viaNote} accessibilityLabel="Said out loud">
            Spoken
          </Text>
        )}
      </View>
    );
  }
  if (message.role === 'notice') {
    const level = message.level ?? 'info';
    const alert = level === 'critical' || level === 'important';
    return (
      <View
        style={[styles.notice, alert && styles.noticeAlert]}
        accessibilityRole="alert"
        accessibilityLabel={`${LEVEL_WORDS[level]}. ${message.text}`}>
        <Icon
          name={alert ? 'triangle-alert' : 'sparkles'}
          size={16}
          color={alert ? colors.amber : colors.limeDark}
        />
        <View style={styles.noticeBody}>
          <Text style={styles.noticeKicker}>{LEVEL_WORDS[level]}</Text>
          <Text style={[styles.noticeText, large && styles.largeText]}>
            {message.text}
          </Text>
        </View>
      </View>
    );
  }
  const waiting = message.streaming && message.text.length === 0;
  const source = sourceLine(message.sources);
  return (
    <View style={styles.botRow}>
      <View
        style={[
          styles.botBubble,
          elevation(1),
          speaking && styles.botSpeaking,
        ]}>
        {waiting ? (
          <Dots />
        ) : message.text ? (
          <Text style={[styles.botText, large && styles.largeText]} selectable>
            {message.text}
          </Text>
        ) : null}
        {message.interrupted && !message.error && (
          <Text style={styles.metaNote}>Stopped.</Text>
        )}
        {message.error ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Icon name="circle-alert" size={14} color={colors.danger} />
            <Text style={styles.errorText}>{message.error}</Text>
          </View>
        ) : null}
        {source && !message.streaming ? (
          <Text style={styles.metaNote}>{source}</Text>
        ) : null}
        {canReplay && message.text && !message.streaming ? (
          <Pressable
            onPress={onReplay}
            accessibilityRole="button"
            accessibilityLabel="Hear this again"
            hitSlop={slopFor(28)}
            style={styles.replay}>
            <Icon name="rotate-ccw" size={14} color={colors.muted} />
            <Text style={styles.replayText}>Hear again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ----------------------------------------------------------------- actions ---

const ACTION_STATE: Record<
  AssistantAction['status'],
  {label: string; tone: 'wait' | 'ok' | 'bad' | 'na'}
> = {
  suggested: {label: 'Suggestion', tone: 'na'},
  pending_approval: {label: 'Needs your OK', tone: 'wait'},
  completed: {label: 'Done', tone: 'ok'},
  failed: {label: 'Didn’t work', tone: 'bad'},
  unavailable: {label: 'Not available', tone: 'na'},
};

/**
 * A button Orbit offers. It says plainly whether it is a suggestion, waiting
 * for approval, done, or failed, and its result text is whatever the app
 * really reported, never a promise.
 */
export function ActionCard({
  action,
  onRun,
  onDismiss,
  needsConsent,
  compact,
}: {
  action: AssistantAction;
  onRun: () => void;
  onDismiss: () => void;
  /** save_preference while the driver has not yet allowed remembering. */
  needsConsent?: boolean;
  compact?: boolean;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const state = ACTION_STATE[action.status];
  const open =
    action.status === 'suggested' || action.status === 'pending_approval';
  const approval = action.status === 'pending_approval';
  return (
    <View
      style={[styles.action, elevation(1), compact && styles.actionCompact]}
      testID={`action-${action.kind}`}>
      <View style={styles.actionHead}>
        <Text style={styles.actionTitle} numberOfLines={2}>
          {action.label}
        </Text>
        <Text
          style={[
            styles.actionChip,
            state.tone === 'ok' && styles.chipOk,
            state.tone === 'wait' && styles.chipWait,
            state.tone === 'bad' && styles.chipBad,
          ]}>
          {state.label}
        </Text>
      </View>
      {action.detail ? (
        <Text style={styles.actionDetail}>{action.detail}</Text>
      ) : null}
      {needsConsent && open ? (
        <Text style={styles.actionDetail}>
          Orbit will keep this on your phone. You can see it and clear it in
          Assistant settings.
        </Text>
      ) : null}
      {action.result ? (
        <Text style={styles.actionResult}>{action.result}</Text>
      ) : null}
      {open ? (
        <View style={styles.actionButtons}>
          <PrimaryButton
            compact
            label={
              needsConsent ? 'Allow and save' : approval ? 'Yes, do it' : 'Open'
            }
            onPress={onRun}
            accessibilityHint={action.label}
            style={styles.flex}
          />
          <SecondaryButton
            compact
            label="Not now"
            onPress={onDismiss}
            style={styles.notNow}
          />
        </View>
      ) : null}
    </View>
  );
}

export function FallbackRow({
  links,
  onOpen,
}: {
  links: FallbackLink[];
  onOpen: (link: FallbackLink) => void;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  return (
    <View style={styles.fallbacks}>
      {links.map(l => (
        <Pressable
          key={l.route + l.label}
          onPress={() => onOpen(l)}
          accessibilityRole="button"
          accessibilityLabel={l.label}
          hitSlop={slopFor(36)}
          style={({pressed}) => [styles.fallback, pressed && {opacity: 0.85}]}>
          <Icon name={l.icon} size={14} color={colors.ink} />
          <Text style={styles.fallbackText}>{l.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- composer ---

export function Composer({
  onSend,
  disabled,
  placeholder = 'Ask Orbit anything about your trip',
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const [value, setValue] = useState('');
  const send = () => {
    const t = value.trim();
    if (!t || disabled) {
      return;
    }
    setValue('');
    onSend(t);
  };
  return (
    <View style={[styles.composer, disabled && styles.composerOff]}>
      <TextInput
        value={value}
        onChangeText={setValue}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel="Type a message to Orbit"
        returnKeyType="send"
        onSubmitEditing={send}
        blurOnSubmit={false}
        maxLength={600}
        maxFontSizeMultiplier={1.3}
        underlineColorAndroid="transparent"
        style={styles.input}
      />
      <Pressable
        onPress={send}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{disabled: disabled || value.trim().length === 0}}
        style={({pressed}) => [
          styles.send,
          value.trim().length === 0 && styles.sendIdle,
          pressed && {opacity: 0.85},
        ]}>
        <Icon name="send" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}

// ----------------------------------------------------------------- context ---

export function ContextChip({icon, text}: {icon: IconName; text: string}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  return (
    <View style={styles.contextChip} accessible accessibilityLabel={text}>
      <Icon name={icon} size={13} color={colors.limeDark} />
      <Text style={styles.contextText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// ----------------------------------------------------------------- consent ---

export function ConsentCard({onAccept}: {onAccept: () => void}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  return (
    <View style={[styles.consent, elevation(1)]} testID="ai-consent">
      <View style={styles.consentHead}>
        <Icon name="shield-check" size={18} color={colors.lime} />
        <Text style={styles.consentTitle}>Turn on Orbit’s AI</Text>
      </View>
      <Text style={styles.consentBody}>
        When you ask Orbit something, your question and the trip details it
        needs (destination, battery level, charger information) go to
        PlugOrbit’s server and an AI service to work out the answer.
      </Text>
      <Text style={styles.consentBody}>
        Orbit never records or keeps your voice. Your phone turns speech into
        text using its own speech service, which may send audio to Google or
        Apple to do that. Orbit can’t pay, book or start charging, and asks
        before it changes anything.
      </Text>
      <PrimaryButton label="Turn on" variant="lime" onPress={onAccept} />
    </View>
  );
}

export function PermissionNote({
  state,
  onOpenSettings,
}: {
  state: PermissionState;
  onOpenSettings: () => void;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  if (state !== 'denied' && state !== 'blocked') {
    return null;
  }
  return (
    <View style={styles.permission} accessibilityRole="alert">
      <Icon name="mic-off" size={16} color={colors.amberOnDark} />
      <Text style={styles.permissionText}>
        Microphone is off for PlugOrbit.
      </Text>
      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Open phone settings"
        hitSlop={slopFor(30)}>
        <Text style={styles.permissionAction}>Settings</Text>
      </Pressable>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  flex: {flex: 1},
  orb: {alignItems: 'center', justifyContent: 'center'},
  ring: {position: 'absolute', backgroundColor: colors.lime},
  arc: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: colors.lime,
  },
  core: {
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreError: {backgroundColor: colors.dangerSoft},
  mic: {
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micLive: {backgroundColor: colors.danger},
  micDisabled: {backgroundColor: colors.chipBorder},
  round: {
    width: sizes.tap,
    height: sizes.tap,
    borderRadius: sizes.tap / 2,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundActive: {backgroundColor: colors.lime, borderColor: colors.lime},

  userRow: {alignItems: 'flex-end', gap: 2},
  userBubble: {
    maxWidth: '86%',
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    borderBottomRightRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  userText: {...type.body, color: colors.surface, lineHeight: 20},
  largeText: {fontSize: 20, lineHeight: 28, fontWeight: '600'},
  viaNote: {...type.caption, color: colors.muted, paddingRight: spacing.xs},
  botRow: {alignItems: 'flex-start'},
  botBubble: {
    maxWidth: '92%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderBottomLeftRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  botSpeaking: {borderWidth: 1.5, borderColor: colors.lime},
  botText: {...type.body, color: colors.ink, lineHeight: 21},
  dots: {...type.title, color: colors.muted},
  metaNote: {...type.caption, color: colors.muted},
  errorBox: {flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start'},
  errorText: {...type.caption, color: colors.danger, flex: 1},
  replay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  replayText: {...type.caption, color: colors.muted},
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.limeSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  noticeAlert: {backgroundColor: colors.amberSoft},
  noticeBody: {flex: 1, gap: 2},
  noticeKicker: {
    ...type.micro,
    color: colors.inkSoft,
    textTransform: 'uppercase',
  },
  noticeText: {...type.body, color: colors.ink, lineHeight: 20},

  action: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  actionCompact: {padding: spacing.md},
  actionHead: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm},
  actionTitle: {...type.heading, color: colors.ink, flex: 1},
  actionChip: {
    ...type.micro,
    color: colors.inkSoft,
    backgroundColor: colors.slateSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  chipOk: {backgroundColor: colors.limeSoft, color: colors.limeDark},
  chipWait: {backgroundColor: colors.amberSoft, color: colors.amber},
  chipBad: {backgroundColor: colors.dangerSoft, color: colors.danger},
  actionDetail: {...type.body, color: colors.inkSoft, lineHeight: 19},
  actionResult: {...type.bodyStrong, color: colors.ink},
  actionButtons: {flexDirection: 'row', gap: spacing.sm, alignItems: 'center'},
  notNow: {minWidth: 96},

  fallbacks: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  fallback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: sizes.chip,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.lime,
  },
  fallbackText: {...type.label, color: colors.ink},

  composerOff: {opacity: 0.6},
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: sizes.field,
  },
  input: {
    flex: 1,
    ...type.body,
    color: colors.ink,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  send: {
    width: sizes.tap,
    height: sizes.tap,
    borderRadius: radii.md,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIdle: {backgroundColor: colors.slateSoft},

  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    height: 30,
    maxWidth: 200,
  },
  contextText: {
    ...type.caption,
    color: colors.ink,
    fontWeight: '700',
    flexShrink: 1,
  },

  consent: {
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  consentHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  consentTitle: {...type.heading, color: colors.surface},
  consentBody: {...type.body, color: colors.chipText, lineHeight: 20},

  permission: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  permissionText: {...type.caption, color: colors.chipText, flex: 1},
  permissionAction: {...type.label, color: colors.lime},
});

const styles=baseStyles;
