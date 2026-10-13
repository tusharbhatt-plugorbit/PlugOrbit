import {useAppearance, useThemedStyles} from '../../appearance';
import React, {useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useNavigation} from '../../navigation/NavigationContext';
import {askOrbit, orbitConfigured} from '../../services/orbitAssistant';
import {colors, radii, spacing, type} from '../../theme';
import {Icon, Screen} from '../../ui';

type Message = {sender: 'you' | 'orbit'; text: string};

const quickQuestions = [
  'How can I find chargers?',
  'How do I plan an EV trip?',
  'What is SOC?',
  'How do I book a slot?',
];

/** Plain, local answers about the app. They never depend on a connection or a provider. */
export function offlineReply(question: string): string {
  const q = question.toLowerCase();
  if (/orbit assist|co-?driver|voice|speak|talk|hindi|hinglish/.test(q)) {
    return 'Orbit Assist is the co-driver that checks your battery, route and chargers for you, by voice or text. Open Profile → Orbit Assist. It needs a signed-in account and a connection; the map and planner work without it.';
  }
  if (/login|sign.?in|google|sms|otp|mobile number|email/.test(q)) {
    return 'Use email verification or Google from the sign-in screen. Google opens a browser: approve your account, then return to PlugOrbit. If mobile SMS reports a billing error, use email or Google while support completes SMS setup.';
  }
  if (/receipt|invoice|gst|download/.test(q)) {
    return 'Open Activity, choose your session and tap Download receipt. Select a folder in Files and tap Save. The app exports a session summary with a GST calculation; get the official GST tax invoice from the charging operator.';
  }
  if (/qr|scan|camera/.test(q)) {
    return 'Go to Charge and choose Scan charger QR. Point the camera at the code, or use the Google scanner if the camera is unavailable. Registered charger codes are checked for compatibility; an operator website QR requires you to choose Open QR website.';
  }
  if (/cafe|coffee|amenit|food|restroom|parking|wifi/.test(q)) {
    return 'Open a station, scroll to Nearby amenities and choose Cafes, Food or another category. Nearby Google Maps results show their addresses and an Open in Maps button. Verify opening hours and access.';
  }
  if (/support|ticket|agent|help desk/.test(q)) {
    return 'Open Support center, choose the issue category and describe what happened. Orbit gives automated initial help, and the ticket goes to the human support inbox. Agent replies appear in your ticket. Never share passwords or OTPs.';
  }
  if (/theme|appearance|light mode|dark mode/.test(q)) {
    return 'Open Profile and Appearance. Choose Light for the bright theme or System to follow your phone settings.';
  }
  if (/sync|back.?up|saved data/.test(q)) {
    return 'Sign in first, then open Profile and Account sync. Tap Sync now to back up supported app data to your account. Keep your connection active until it completes.';
  }
  if (/route|trip|travel|distance|navigation/.test(q)) {
    return 'Open Trips → Route Planner. Enter your destination and review charging stops. Check live charger availability before departing.';
  }
  if (/charger|station|nearby|location|map/.test(q)) {
    return 'Go to Home → Find chargers to explore nearby stations on the map. Turn on location permissions and check station details for connector compatibility.';
  }
  if (/soc|battery|range|percent/.test(q)) {
    return 'SOC means State of Charge: the battery percentage remaining. For longer trips, plan an arrival buffer and verify your car’s real-world range.';
  }
  if (/book|reserv|slot|payment|wallet/.test(q)) {
    return 'Open a station and check whether a Reservation option is offered. Confirm the operator, price and payment availability before booking.';
  }
  return 'I can guide you through charging stations, trip planning, battery SOC and reservations. Choose a suggested question or ask about these features. For help with a live journey, open Orbit Assist.';
}

/**
 * The help guide: answers about how PlugOrbit works. Offline it matches a question to a
 * written answer; when the Backend has a guide model configured it can also answer
 * free-form questions online. Orbit Assist (voice, tools, the live journey) is the
 * separate co-driver this screen points to.
 */
export default function AIAssistantScreen(): React.JSX.Element {
  const {colors: palette} = useAppearance();
  const styles = useThemedStyles(baseStyles);

  const nav = useNavigation();
  const threadRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const [draft, setDraft] = useState('');
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    orbitConfigured()
      .then(value => {
        if (alive) {
          setOnline(value);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'orbit',
      text: 'Hi! I can answer questions about how PlugOrbit works: sign-in, chargers, trips, receipts and support.',
    },
  ]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || sending.current) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    const history = messages.slice(1);
    setMessages(prev => [...prev, {sender: 'you', text: question}]);
    setDraft('');
    try {
      const answer = online
        ? await askOrbit(question, history)
        : offlineReply(question);
      setMessages(prev => [...prev, {sender: 'orbit', text: answer}]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Orbit.');
      setDraft(question);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const compose = (
    <View style={styles.compose}>
      <TextInput
        accessibilityLabel="Message to Orbit"
        maxLength={2000}
        style={styles.input}
        placeholder="Ask about PlugOrbit…"
        placeholderTextColor={palette.placeholderOnLight}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => send(draft)}
        returnKeyType="send"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send message"
        disabled={!draft.trim() || busy}
        accessibilityState={{disabled: !draft.trim() || busy}}
        onPress={() => send(draft)}
        style={[styles.send, !draft.trim() && styles.sendDisabled]}>
        <Icon name="send" size={20} color={palette.onAccent} />
      </Pressable>
    </View>
  );

  return (
    <Screen title="Orbit help guide" scroll={false} footer={compose}>
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          {online
            ? 'Online answers about PlugOrbit'
            : 'Offline help guide: works without a connection'}
        </Text>
      </View>
      <ScrollView
        ref={threadRef}
        onContentSizeChange={() =>
          threadRef.current?.scrollToEnd({animated: true})
        }
        showsVerticalScrollIndicator={false}
        style={styles.flex}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled">
        {messages.map((m, i) => (
          <View
            key={i}
            style={[styles.bubble, m.sender === 'you' ? styles.mine : styles.orbit]}>
            <Text style={[styles.message, m.sender === 'you' && styles.mineText]}>
              {m.text}
            </Text>
          </View>
        ))}
        <View style={styles.suggestions}>
          {quickQuestions.map(q => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={q}
              key={q}
              onPress={() => send(q)}
              style={styles.chip}>
              <Text style={styles.chipText}>{q}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => nav.navigate('Assistant')}
          style={styles.route}>
          <Text style={styles.routeText}>Talk to Orbit Assist →</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => nav.navigate('RoutePlanner')}
          style={styles.routeSecondary}>
          <Text style={styles.routeSecondaryText}>Plan an EV trip →</Text>
        </Pressable>
      </ScrollView>
      {busy && <Text style={styles.noticeText}>Orbit is thinking…</Text>}
      {!!error && (
        <View style={styles.errorBox}>
          <Text accessibilityRole="alert" style={styles.noticeText}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use offline help"
            onPress={() => {
              setOnline(false);
              setError('');
            }}
            style={styles.chip}>
            <Text style={styles.chipText}>Use offline help</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const baseStyles = StyleSheet.create({
  flex: {flex: 1},
  notice: {
    backgroundColor: colors.infoSoft,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  noticeText: {...type.label, color: colors.info},
  errorBox: {gap: spacing.sm, paddingVertical: spacing.sm},
  thread: {gap: spacing.md, paddingBottom: spacing.lg},
  bubble: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    maxWidth: '90%',
    borderWidth: 1,
  },
  mine: {
    backgroundColor: colors.bg,
    borderColor: colors.bg,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 6,
  },
  orbit: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 6,
  },
  message: {...type.body, color: colors.ink, lineHeight: 22},
  mineText: {color: '#FFFFFF'},
  suggestions: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm},
  chip: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  chipText: {...type.label, color: colors.ink},
  route: {
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.lime,
    minHeight: 50,
    justifyContent: 'center',
  },
  routeText: {...type.button, color: colors.onAccent},
  routeSecondary: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    minHeight: 50,
    justifyContent: 'center',
  },
  routeSecondaryText: {...type.button, color: colors.ink},
  compose: {flexDirection: 'row', gap: spacing.md, alignItems: 'center'},
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderColor: colors.inputBorder,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    color: colors.ink,
    minHeight: 50,
  },
  send: {
    borderRadius: radii.md,
    backgroundColor: colors.lime,
    height: 50,
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {backgroundColor: colors.slateSoft},
});
