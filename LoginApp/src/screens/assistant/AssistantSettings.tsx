import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {getAssistant} from '../../assistant/runtime';
import {
  clearPreferences,
  eraseAssistantData,
  removePreference,
  updateSettings,
  useAssistantState,
} from '../../assistant/store';
import type {ResponseStyle, VoiceLanguage} from '../../assistant/types';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  KeyValue,
  SecondaryButton,
  SegmentedControl,
  TextButton,
  ToggleRow,
} from '../../ui';

const LANGUAGES: ReadonlyArray<{value: VoiceLanguage; label: string}> = [
  {value: 'auto', label: 'Auto'},
  {value: 'en', label: 'English'},
  {value: 'hi', label: 'हिन्दी'},
  {value: 'hinglish', label: 'Hinglish'},
];
const STYLES: ReadonlyArray<{value: ResponseStyle; label: string}> = [
  {value: 'brief', label: 'Brief'},
  {value: 'detailed', label: 'Detailed'},
];

const MIC_WORDS = {
  unknown: 'Asked the first time you talk',
  granted: 'Allowed',
  denied: 'Not allowed',
  blocked: 'Blocked in phone settings',
  unavailable: 'Not available on this phone',
} as const;

const GATEWAY_WORDS = {
  unknown: 'Not checked yet',
  ready: 'Ready',
  unavailable: 'Not available right now',
  signed_out: 'Sign in to use it',
  offline: 'Offline',
} as const;

const PREF_WORDS: Record<string, string> = {
  min_arrival_soc_pct: 'Arrival reserve',
  strategy: 'Route priority',
  preferred_network: 'Preferred network',
  min_charger_kw: 'Minimum charger power',
  max_stops: 'Most stops',
  prioritise: 'Priority',
};

/** Voice, language, privacy and "forget" controls. Everything here is reversible. */
export function AssistantSettings({
  onOpenPhoneSettings,
}: {
  onOpenPhoneSettings: () => void;
}) {
  const assistant = getAssistant();
  const settings = useAssistantState(s => s.settings);
  const prefs = useAssistantState(s => s.preferences);
  const journey = useAssistantState(s => s.journey);
  const microphone = useAssistantState(s => s.microphone);
  const gateway = useAssistantState(s => s.gateway);
  const synthAvailable = useAssistantState(s => s.synthAvailable);
  const recognizerAvailable = useAssistantState(s => s.recognizerAvailable);

  return (
    <View style={styles.wrap}>
      <Text style={styles.section}>Voice</Text>
      <Card>
        <View style={styles.pad}>
          <Text style={styles.label}>Language</Text>
          <SegmentedControl
            options={LANGUAGES}
            value={settings.voiceLanguage}
            onChange={v => updateSettings({voiceLanguage: v})}
          />
          <Text style={styles.help}>
            Auto follows how you speak. Hindi answers in Devanagari; Hinglish in
            English letters.
          </Text>
        </View>
        <View style={styles.pad}>
          <Text style={styles.label}>Answer style</Text>
          <SegmentedControl
            options={STYLES}
            value={settings.responseStyle}
            onChange={v => updateSettings({responseStyle: v})}
          />
        </View>
        <ToggleRow
          title="Text only"
          subtitle="Never speak out loud; read answers on screen."
          value={settings.textOnly}
          onValueChange={async v => {
            updateSettings({textOnly: v});
            if (v) {
              await assistant.setMuted(settings.muted);
              await assistant.interrupt();
            }
          }}
        />
        <ToggleRow
          title="Mute voice"
          subtitle="Silence Orbit for now. You can still hear an answer again."
          value={settings.muted}
          disabled={settings.textOnly}
          onValueChange={v => assistant.setMuted(v)}
        />
        <ToggleRow
          title="Speak alerts"
          subtitle="Read out stop reminders and charger problems."
          value={settings.speakProactive}
          disabled={settings.textOnly}
          onValueChange={v => updateSettings({speakProactive: v})}
          last
        />
      </Card>

      <Text style={styles.section}>While driving</Text>
      <Card>
        <ToggleRow
          title="Driving mode"
          subtitle="A large microphone and short spoken answers. Typed questions are read aloud too."
          value={settings.drivingMode}
          onValueChange={v => updateSettings({drivingMode: v})}
          last
        />
      </Card>

      <Text style={styles.section}>Status</Text>
      <Card>
        <KeyValue label="Microphone" value={MIC_WORDS[microphone]} />
        <KeyValue
          label="Speech to text"
          value={recognizerAvailable ? 'Available' : 'Not available'}
        />
        <KeyValue
          label="Spoken answers"
          value={synthAvailable ? 'Available' : 'Not available'}
        />
        <KeyValue label="Orbit’s AI" value={GATEWAY_WORDS[gateway.health]} />
        {(microphone === 'denied' || microphone === 'blocked') && (
          <TextButton
            label="Open phone settings"
            icon="settings"
            onPress={onOpenPhoneSettings}
          />
        )}
      </Card>

      <Text style={styles.section}>Privacy and memory</Text>
      <Card>
        <ToggleRow
          title="Remember my preferences"
          subtitle="Keep things you ask Orbit to remember, like “I prefer cheaper chargers”, on this phone."
          value={settings.rememberPreferences}
          onValueChange={v => updateSettings({rememberPreferences: v})}
          last
        />
      </Card>
      {prefs.length > 0 ? (
        <Card>
          <Text style={styles.label}>Orbit remembers</Text>
          {prefs.map(p => (
            <View key={p.key} style={styles.prefRow}>
              <Text style={styles.prefText}>
                {PREF_WORDS[p.key] ?? p.key}: {p.value}
              </Text>
              <TextButton
                label="Forget"
                tone="danger"
                onPress={() => removePreference(p.key)}
              />
            </View>
          ))}
        </Card>
      ) : (
        <Text style={styles.help}>Nothing saved.</Text>
      )}
      {journey?.destination ? (
        <Text style={styles.help}>
          For this journey Orbit knows: to {journey.destination}
          {journey.min_arrival_soc_pct !== undefined
            ? `, keep ${journey.min_arrival_soc_pct}%`
            : ''}
          .
        </Text>
      ) : null}
      <Text style={styles.help}>
        Orbit never keeps recordings of your voice. Conversations are not saved
        when you close the app.
      </Text>

      <View style={styles.buttons}>
        <SecondaryButton
          label="Clear this conversation"
          icon="trash2"
          onPress={() => assistant.clearHistory()}
        />
        <SecondaryButton
          label="Forget saved preferences"
          icon="trash2"
          disabled={prefs.length === 0}
          onPress={clearPreferences}
        />
        <SecondaryButton
          label="Erase everything Orbit keeps"
          icon="trash2"
          tone="danger"
          onPress={async () => {
            await assistant.clearHistory();
            eraseAssistantData();
          }}
        />
        {settings.aiConsentAt !== null && (
          <SecondaryButton
            label="Turn off Orbit’s AI"
            icon="x"
            tone="danger"
            onPress={async () => {
              await assistant.endConversation();
              updateSettings({aiConsentAt: null});
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: spacing.md},
  section: {
    ...type.micro,
    color: colors.muted,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  pad: {gap: spacing.sm, paddingBottom: spacing.lg},
  label: {...type.label, color: colors.ink},
  help: {...type.caption, color: colors.muted, lineHeight: 18},
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  prefText: {...type.body, color: colors.ink, flex: 1},
  buttons: {gap: spacing.sm, marginTop: spacing.sm},
});
