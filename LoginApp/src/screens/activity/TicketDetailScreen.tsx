import React, {useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import type {TicketStatus} from '../../domain/types';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
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
} from '../../ui';
import {KeyboardSpacer} from '../../ui/KeyboardSpacer';

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
  const nav = useNavigation();
  const {params} = useRoute<'TicketDetail'>();
  const {support} = useServices();
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
              onChangeText={setText}
              placeholder="Write a reply…"
              placeholderTextColor={colors.placeholder}
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
                    color={colors.ink}
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

      <SectionTitle title="Conversation" />
      {ticket.messages.map(m => (
        <View
          key={m.id}
          style={[
            styles.bubble,
            m.from === 'user' ? styles.mine : styles.theirs,
          ]}>
          <Text style={[styles.who, m.from === 'user' && styles.whoMine]}>
            {m.from === 'user' ? 'You' : 'PlugOrbit support'}
          </Text>
          <Text style={[styles.msg, m.from === 'user' && styles.msgMine]}>
            {m.text}
          </Text>
          <Text style={[styles.time, m.from === 'user' && styles.timeMine]}>
            {formatDateTime(m.at)}
          </Text>
        </View>
      ))}
      {error && <Notice tone="danger" title="Couldn’t send" body={error} />}
      <KeyboardSpacer />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
