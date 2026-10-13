import {useAppearance, useThemedStyles} from '../../appearance';
import React, {useEffect, useState} from 'react';
import {Linking, StyleSheet, Text, TextInput, View} from 'react-native';
import {SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP_URL} from '../../config/support';
import {describeError} from '../../domain/describeError';
import type {TicketStatus} from '../../domain/types';
import {useIsActiveRef, useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, radii, sizes, spacing, type} from '../../theme';
import {formatDateTime} from '../../utils/format';
import {
  Card,
  EmptyState,
  Icon,
  IconButton,
  ListCard,
  ListRow,
  Notice,
  Pill,
  Screen,
  SectionTitle,
  TextButton,
  showToast,
} from '../../ui';

const STATUS: Record<
  TicketStatus,
  {label: string; tone: 'amber' | 'info' | 'lime'}
> = {
  open: {label: 'Open', tone: 'amber'},
  in_review: {label: 'In review', tone: 'info'},
  resolved: {label: 'Resolved', tone: 'lime'},
};
const STEPS: TicketStatus[] = ['open', 'in_review', 'resolved'];

/** 23 Ticket detail: the conversation and where the ticket is. */
export default function TicketDetailScreen(): React.JSX.Element {
  const {colors}=useAppearance();
  const styles=useThemedStyles(baseStyles);

  const nav = useNavigation();
  const contact = async (url: string, channel: string) => {
    try {await Linking.openURL(url);} catch {showToast(`Could not open ${channel} on this phone.`, 'warn');}
  };
  const {params} = useRoute<'TicketDetail'>();
  const {support} = useServices();
  const active = useIsActiveRef();
  useEffect(() => {
    if (!support.get) return;
    let fetching = false;
    const refresh = async () => {
      if (!active.current || fetching) return;
      fetching = true;
      try {await support.get?.(params.ticketId);} catch { /* Existing messages remain available offline. */ }
      finally {fetching = false;}
    };
    refresh(); const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [active, params.ticketId, support]);
  const ticket = useApp(s => s.tickets.find(t => t.id === params.ticketId));
  const linked = useApp(s =>
    s.history.find(h => h.id === ticket?.linkedSessionId),
  );
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ticket) {
    return (
      <Screen title="Ticket">
        <EmptyState
          icon="message-circle"
          title="Ticket not found"
          body="It may have been removed."
          primary={{
            label: 'Back to support',
            onPress: () => nav.navigate('Support'),
          }}
        />
      </Screen>
    );
  }

  const send = async () => {
    const body = text.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await support.reply(ticket.id, body);
      setText('');
    } catch (e) {
      setError(describeError(e, 'We couldn’t send your message.').body);
    }
    setSending(false);
  };

  const s = STATUS[ticket.status];
  const stepIndex = STEPS.indexOf(ticket.status);

  return (
    <Screen
      title={`#${ticket.number}`}
      stack
      footer={
        ticket.status === 'resolved' ? (
          <Text style={styles.closed}>
            This ticket is resolved. Start a new one if you still need help.
          </Text>
        ) : (
          <View style={styles.composer}>
            <TextInput
              value={text}
              maxLength={2000}
              onChangeText={setText}
              placeholder="Write a reply…"
              placeholderTextColor={colors.placeholderOnLight}
              style={styles.input}
              multiline
              accessibilityLabel="Reply"
            />
            <IconButton
              icon="send"
              label="Send reply"
              tone="lime"
              onPress={send}
            />
          </View>
        )
      }>
      <View style={styles.head}>
        <Text style={styles.title}>{ticket.title}</Text>
        <Pill label={s.label} tone={s.tone} uppercase />
      </View>

      <Card>
        <View style={styles.steps}>
          {STEPS.map((st, i) => (
            <View key={st} style={styles.step}>
              <View style={[styles.stepDot, i <= stepIndex && styles.stepOn]}>
                {i <= stepIndex && (
                  <Icon
                    name="check"
                    size={12}
                    color={colors.onAccent}
                    strokeWidth={3}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  i === stepIndex && styles.stepLabelOn,
                ]}>
                {STATUS[st].label}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {linked && (
        <ListCard>
          <ListRow
            icon="receipt"
            title="Linked session"
            subtitle={`${linked.stationName} • ${linked.id}`}
            onPress={() =>
              nav.navigate('SessionDetail', {sessionId: linked.id})
            }
            last
          />
        </ListCard>
      )}

      <SectionTitle title="Contact support" />
      <ListCard>
        <ListRow icon="mail" title="Email support" subtitle={SUPPORT_EMAIL}
          onPress={() => contact(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`PlugOrbit ticket #${ticket.number}`)}`, 'email')} />
        {SUPPORT_PHONE !== '' && <ListRow icon="phone" title="Call support" subtitle={SUPPORT_PHONE}
          onPress={() => contact(`tel:${SUPPORT_PHONE}`, 'the phone')} />}
        {SUPPORT_WHATSAPP_URL !== '' && <ListRow icon="message-circle" title="WhatsApp support"
          onPress={() => contact(`${SUPPORT_WHATSAPP_URL}?text=${encodeURIComponent(`Help with PlugOrbit ticket #${ticket.number}`)}`, 'WhatsApp')} last />}
      </ListCard>
      <SectionTitle title="Conversation" />
      {ticket.messages.map(m => (
        <View
          key={m.id}
          style={[
            styles.bubble,
            m.from === 'user' ? styles.mine : styles.theirs,
          ]}>
          <Text style={[styles.who, m.from === 'user' && styles.whoMine]}>
            {m.from === 'user' ? 'You' : m.author === 'orbit' ? 'Orbit AI' : m.author === 'orbit_guide' ? 'Orbit automated guide' : m.author === 'agent' ? 'PlugOrbit support agent' : 'Saved support message'}
          </Text>
          <Text style={[styles.msg, m.from === 'user' && styles.msgMine]}>
            {m.text}
          </Text>
          <Text style={[styles.time, m.from === 'user' && styles.timeMine]}>
            {formatDateTime(m.at)}
          </Text>
        </View>
      ))}
      {support.get && !/^[0-9a-f]{40}$/.test(ticket.id) && <Notice tone="warn" title="Start a new support request" body="This saved ticket is not in the live support inbox. Open a new ticket so the team can review your issue." action={<TextButton label="Open new ticket" onPress={() => nav.navigate('Support')} />} />}
      {error && <Notice tone="danger" title="Couldn’t send" body={error} />}

    </Screen>
  );
}

const baseStyles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {...type.h1, color: colors.ink, flex: 1},
  steps: {flexDirection: 'row', justifyContent: 'space-between'},
  step: {alignItems: 'center', gap: 6, flex: 1},
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.slateSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepOn: {backgroundColor: colors.lime},
  stepLabel: {...type.caption, color: colors.muted},
  stepLabelOn: {color: colors.ink, fontWeight: '800'},
  bubble: {
    maxWidth: '88%',
    padding: spacing.md,
    borderRadius: radii.lg,
    gap: 4,
  },
  theirs: {alignSelf: 'flex-start', backgroundColor: colors.surface},
  mine: {alignSelf: 'flex-end', backgroundColor: colors.bg},
  who: {...type.micro, color: colors.limeDark},
  whoMine: {color: colors.lime},
  msg: {...type.body, color: colors.ink, lineHeight: 20},
  msgMine: {color: '#FFFFFF'},
  time: {...type.caption, color: colors.muted, fontSize: 11},
  timeMine: {color: colors.placeholder},
  composer: {flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm},
  input: {
    flex: 1,
    minHeight: sizes.field,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    fontSize: 15,
    color: colors.ink,
  },
  closed: {...type.caption, color: colors.muted, textAlign: 'center'},
});
