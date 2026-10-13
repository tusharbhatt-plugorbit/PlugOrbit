import {useAppearance,useThemedStyles} from '../../appearance';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { updateSettings } from '../../assistant/store';
import { useRoute } from '../../navigation/NavigationContext';
import { colors, radii, spacing, type } from '../../theme';
import {
  ActionCard,
  BottomSheet,
  Chip,
  Composer,
  ConsentCard,
  ContextChip,
  FallbackRow,
  IconButton,
  MessageBubble,
  MicButton,
  PermissionNote,
  RoundAction,
  Screen,
  SecondaryButton,
  VoiceOrb,
} from '../../ui';
import { AssistantSettings } from './AssistantSettings';
import { DrivingMode } from './DrivingMode';
import {
  AssistantView,
  needsMemoryConsent,
  statusText,
  useAssistantOpened,
  useAssistantView,
} from './useAssistantView';

/** Prompts to tap, not scripted answers: each one is sent to the assistant like typed text. */
const SUGGESTIONS = [
  'Can I reach Jaipur with my current battery?',
  'Find the fastest charger on my way',
  'Which charging station is cheapest?',
  'How much will this trip cost?',
];

/** The transcript and the cards under each message, shared by the screen and the sheet. */
export function Conversation({
  view,
  messages = view.messages,
}: {
  view: AssistantView;
  messages?: AssistantView['messages'];
}) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const { assistant, settings } = view;
  return (
    <>
      {messages.map(m => (
        <View key={m.id} style={styles.item}>
          <MessageBubble
            message={m}
            canReplay={view.canSpeak && m.role === 'assistant'}
            speaking={view.speakingId === m.id}
            onReplay={() => assistant.replay(m.id)}
          />
          {m.actions?.map(a => (
            <ActionCard
              key={a.id}
              action={a}
              needsConsent={needsMemoryConsent(a, settings.rememberPreferences)}
              onRun={() =>
                assistant.runAction(m.id, a.id, {
                  consent: needsMemoryConsent(a, settings.rememberPreferences),
                })
              }
              onDismiss={() => assistant.dismissAction(m.id, a.id)}
            />
          ))}
          {m.fallbacks && m.fallbacks.length > 0 ? (
            <FallbackRow links={m.fallbacks} onOpen={view.openFallback} />
          ) : null}
        </View>
      ))}
    </>
  );
}

/**
 * Orb + one live line: what Orbit is doing, or what it is hearing. While idle and
 * healthy it stays out of the way (the microphone says the same thing).
 */
export function VoiceStage({ view }: { view: AssistantView }) {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const trouble =
    view.gateway.health === 'offline' ||
    view.gateway.health === 'signed_out' ||
    view.gateway.health === 'unavailable';
  if (view.phase === 'idle' && !trouble) {
    return null;
  }
  return (
    <View style={styles.stage} testID="voice-stage">
      <VoiceOrb phase={view.phase} level={view.level} size={76} />
      <View style={styles.stageText}>
        <Text style={styles.stageKicker}>ORBIT ASSIST</Text>
        <Text
          style={styles.stageStatus}
          accessibilityLiveRegion="polite"
          numberOfLines={3}
        >
          {statusText(view)}
        </Text>
      </View>
    </View>
  );
}

export default function AssistantScreen() {
 const {colors}=useAppearance(); const styles=useThemedStyles(baseStyles);

  const view = useAssistantView();
  const { params } = useRoute<'Assistant'>();
  const { assistant, settings, nav } = view;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useAssistantOpened(true);

  // A button that says "Talk to Orbit" opens the microphone straight away, once.
  const listened = useRef(false);
  useEffect(() => {
    if (
      params?.listen &&
      !listened.current &&
      view.consented &&
      view.canListen
    ) {
      listened.current = true;
      assistant.startListening();
    }
  }, [params?.listen, view.consented, view.canListen, assistant]);

  const lastLength = view.messages[view.messages.length - 1]?.text.length ?? 0;
  useEffect(() => {
    if (view.messages.length > 0) {
      scroll.current?.scrollToEnd({ animated: true });
    }
  }, [view.messages.length, lastLength]);

  const end = async () => {
    await assistant.endConversation();
    if (nav.canGoBack()) {
      nav.goBack();
    }
  };

  if (settings.drivingMode) {
    return (
      <>
        <DrivingMode
          view={view}
          onExit={async () => {
            await assistant.interrupt();
            updateSettings({ drivingMode: false });
          }}
          onEnd={end}
        />
      </>
    );
  }

  const busy = view.phase === 'thinking' || view.phase === 'speaking';
  const empty = view.messages.length === 0;
  return (
    <>
      <Screen
        title="Orbit Assist"
        scroll={false}
        right={
          <IconButton
            icon="settings"
            label="Assistant settings"
            onPress={() => setSettingsOpen(true)}
          />
        }
        footer={
          !view.consented ? undefined : (
            <View style={styles.footer}>
              <Composer
                onSend={view.send}
                disabled={!view.consented}
                placeholder={
                  view.consented ? 'Type to Orbit' : 'Turn on Orbit’s AI first'
                }
              />
              <View style={styles.controls}>
                <RoundAction
                  icon={
                    settings.muted || settings.textOnly ? 'volume-x' : 'volume2'
                  }
                  label={settings.muted ? 'Unmute Orbit' : 'Mute Orbit'}
                  active={settings.muted || settings.textOnly}
                  disabled={settings.textOnly}
                  onPress={() => assistant.setMuted(!settings.muted)}
                />
                <RoundAction
                  icon="circle-stop"
                  label="Stop talking"
                  disabled={!busy}
                  onPress={() => assistant.interrupt()}
                />
                <MicButton
                  phase={view.phase}
                  disabled={!view.canListen}
                  onPress={view.toggleMic}
                />
                <RoundAction
                  icon="rotate-ccw"
                  label="Hear the last answer again"
                  disabled={!view.canSpeak || view.messages.length === 0}
                  onPress={() => assistant.replay()}
                />
                <RoundAction icon="x" label="End conversation" onPress={end} />
              </View>
            </View>
          )
        }
      >
        <View style={styles.context}>
          {view.context.map(c => (
            <ContextChip key={c.text} icon={c.icon} text={c.text} />
          ))}
        </View>

        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {!view.consented ? (
            <ConsentCard onAccept={() => assistant.grantConsent()} />
          ) : empty ? (
            <View style={styles.intro}>
              <Text style={styles.introTitle}>Where are we going?</Text>
              <Text style={styles.introBody}>
                Ask in English, हिन्दी or Hinglish. Orbit checks your battery,
                the route and the chargers, then tells you what to do.
              </Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map(s => (
                  <Chip key={s} label={s} onPress={() => view.send(s)} />
                ))}
              </View>
              {!view.canListen && view.consented ? (
                <Text style={styles.introBody}>
                  Voice isn’t available on this phone right now, so type your
                  questions instead.
                </Text>
              ) : null}
            </View>
          ) : (
            <Conversation view={view} />
          )}
        </ScrollView>

        <PermissionNote
          state={view.microphone}
          onOpenSettings={view.openPhoneSettings}
        />
        <VoiceStage view={view} />
        {view.gateway.health === 'signed_out' ||
        view.gateway.health === 'unavailable' ? (
          <SecondaryButton
            compact
            label="Plan a route manually"
            icon="route"
            onPress={() => nav.navigate('RoutePlanner')}
          />
        ) : null}
      </Screen>

      <BottomSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Assistant settings"
      >
        <AssistantSettings onOpenPhoneSettings={view.openPhoneSettings} />
      </BottomSheet>
    </>
  );
}

const baseStyles = StyleSheet.create({
  flex: { flex: 1 },
  context: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  list: { gap: spacing.md, paddingVertical: spacing.sm, flexGrow: 1 },
  item: { gap: spacing.sm },
  intro: { gap: spacing.md, paddingVertical: spacing.md },
  introTitle: { ...type.h1, color: colors.ink },
  introBody: { ...type.body, color: colors.inkSoft, lineHeight: 20 },
  chips: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing.sm },
  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  stageText: { flex: 1, gap: 2 },
  stageKicker: { ...type.micro, color: colors.lime },
  stageStatus: { ...type.bodyStrong, color: colors.surface },
  footer: { gap: spacing.md },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

const styles=baseStyles;
