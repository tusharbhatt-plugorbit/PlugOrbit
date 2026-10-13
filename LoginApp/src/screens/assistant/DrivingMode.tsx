import {useAppearance,useThemedStyles} from '../../appearance';
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, radii, spacing, type} from '../../theme';
import {
  IconButton,
  MicButton,
  PermissionNote,
  RoundAction,
  Screen,
  VoiceOrb,
} from '../../ui';
import {AssistantView, statusText} from './useAssistantView';

/**
 * Minimal interface for the road: one large microphone, one short status, the
 * last thing Orbit said, and the single next step of the trip. No typing.
 */
export function DrivingMode({
  view,
  onExit,
  onEnd,
}: {
  view: AssistantView;
  onExit: () => void;
  onEnd: () => void;
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const {assistant, phase, settings, level, messages} = view;
  const latest = [...messages].reverse().find(m => m.role !== 'user' && m.text);
  const busy = phase === 'thinking' || phase === 'speaking';
  const status = statusText(view);
  return (
    <Screen
      title="Driving mode"
      dark
      hideBack
      scroll={false}
      right={
        <IconButton
          icon="x"
          label="Leave driving mode"
          tone="dark"
          onPress={onExit}
        />
      }>
      <View style={styles.wrap} testID="driving-mode">
        {view.tripLine ? (
          <View
            style={styles.next}
            accessible
            accessibilityLabel={`Your trip. ${view.tripLine}`}>
            <Text style={styles.kicker}>YOUR TRIP</Text>
            <Text style={styles.nextText} numberOfLines={2}>
              {view.tripLine}
            </Text>
          </View>
        ) : null}

        <View style={styles.center}>
          <VoiceOrb phase={phase} level={level} size={176} />
          <Text
            style={styles.status}
            accessibilityLiveRegion="polite"
            numberOfLines={3}>
            {status}
          </Text>
          {latest ? (
            <Text
              style={styles.answer}
              numberOfLines={5}
              accessibilityLabel={`Orbit said: ${latest.text}`}>
              {latest.text}
            </Text>
          ) : null}
        </View>

        <PermissionNote
          state={view.microphone}
          onOpenSettings={view.openPhoneSettings}
        />

        <View style={styles.bottom}>
          <MicButton
            phase={phase}
            size={132}
            disabled={!view.canListen}
            onPress={view.toggleMic}
          />
          <View style={styles.row}>
            <RoundAction
              icon={settings.muted ? 'volume-x' : 'volume2'}
              label={settings.muted ? 'Unmute Orbit' : 'Mute Orbit'}
              active={settings.muted}
              disabled={settings.textOnly}
              onPress={() => assistant.setMuted(!settings.muted)}
            />
            <RoundAction
              icon="circle-stop"
              label="Stop talking"
              disabled={!busy}
              onPress={() => assistant.interrupt()}
            />
            <RoundAction
              icon="rotate-ccw"
              label="Hear the last answer again"
              disabled={!view.canSpeak || messages.length === 0}
              onPress={() => assistant.replay()}
            />
            <RoundAction icon="x" label="End conversation" onPress={onEnd} />
          </View>
        </View>
      </View>
    </Screen>
  );
}

const baseStyles = StyleSheet.create({
  wrap: {flex: 1, gap: spacing.lg},
  next: {
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: 2,
  },
  kicker: {...type.micro, color: colors.lime},
  nextText: {...type.heading, color: colors.surface, fontSize: 18},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  status: {...type.display, color: colors.surface, textAlign: 'center'},
  answer: {
    ...type.title,
    color: colors.chipText,
    textAlign: 'center',
    fontSize: 20,
    lineHeight: 28,
  },
  bottom: {alignItems: 'center', gap: spacing.lg, paddingBottom: spacing.md},
  row: {flexDirection: 'row', gap: spacing.lg},
});

const styles=baseStyles;
