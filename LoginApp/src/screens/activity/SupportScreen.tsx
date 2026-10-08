import React, {useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {SUPPORT_PHONE, SUPPORT_WHATSAPP_URL} from '../../config/support';
import {describeError} from '../../domain/describeError';
import type {TicketCategory} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {formatDate} from '../../utils/format';
import {
  BottomSheet,
  Chip,
  Icon,
  ListCard,
  ListRow,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SectionTitle,
  showToast,
  SupportTicketCard,
  TextField,
} from '../../ui';
import {KeyboardSpacer} from '../../ui/KeyboardSpacer';

const CATEGORIES: ReadonlyArray<{
  value: TicketCategory;
  title: string;
  sub: string;
  icon: 'zap' | 'credit-card' | 'map-pin';
}> = [
  {
    value: 'charging',
    title: 'Charging issue',
    sub: 'Didn’t start, stopped early, slow',
    icon: 'zap',
  },
  {
    value: 'payment',
    title: 'Payment issue',
    sub: 'Charged twice, refund, failed payment',
    icon: 'credit-card',
  },
  {
    value: 'station',
    title: 'Station issue',
    sub: 'Offline, blocked, wrong details',
    icon: 'map-pin',
  },
];

const FAQ = [
  {
    q: 'Why is a charger marked “Estimated”?',
    a: 'Only live feeds from the operator are marked LIVE. Anything older, or from another source, is labelled Estimated, User-confirmed or Unknown, with when it was last updated.',
  },
  {
    q: 'Why can’t I start some chargers here?',
    a: 'Chargers marked “Operator app” run on other networks. We guide you there, but they start and bill the session themselves.',
  },
  {
    q: 'What is the hold on my payment method?',
    a: 'A pre-authorisation before a PlugOrbit-controlled start. You pay only for the energy you use; the rest is released.',
  },
];

/** 22 Support center. */
export default function SupportScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {support} = useServices();
  const tickets = useApp(s => s.tickets);
  const history = useApp(s => s.history);
  const plus = useApp(s => s.plus.active);

  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [linked, setLinked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const reset = () => {
    setCategory(null);
    setTitle('');
    setMessage('');
    setLinked(null);
    setError(null);
  };

  const submit = async () => {
    if (!category || !title.trim() || !message.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const t = await support.createTicket({
        category,
        title: title.trim(),
        message: message.trim(),
        linkedSessionId: linked,
      });
      reset();
      showToast(`Ticket #${t.number} opened.`, 'success');
      nav.navigate('TicketDetail', {ticketId: t.id});
    } catch (e) {
      setError(describeError(e, 'We couldn’t open your ticket.').body);
    }
    setBusy(false);
  };

  const contact = async (url: string, label: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      showToast(`Couldn’t open ${label} on this device.`, 'warn');
    }
  };

  const openTickets = tickets.filter(t => t.status !== 'resolved');

  return (
    <Screen title="Support center" stack>
      {plus && (
        <Pill label="Priority support • Plus" tone="lime" icon="crown" />
      )}

      <SectionTitle title="How can we help?" />
      <ListCard>
        {CATEGORIES.map((c, i) => (
          <ListRow
            key={c.value}
            icon={c.icon}
            iconTone={
              c.value === 'payment'
                ? 'info'
                : c.value === 'station'
                ? 'warn'
                : 'lime'
            }
            title={c.title}
            subtitle={c.sub}
            onPress={() => setCategory(c.value)}
            last={i === CATEGORIES.length - 1}
          />
        ))}
      </ListCard>

      <ListCard>
        <ListRow
          icon="phone"
          title="Call us"
          subtitle="Talk to a person"
          onPress={() => contact(`tel:${SUPPORT_PHONE}`, 'the phone')}
        />
        <ListRow
          icon="message-circle"
          iconTone="lime"
          title="WhatsApp"
          subtitle="Message us, we reply here too"
          onPress={() => contact(SUPPORT_WHATSAPP_URL, 'WhatsApp')}
          last
        />
      </ListCard>

      {openTickets.length > 0 && (
        <>
          <SectionTitle title="Your open tickets" />
          {openTickets.map(t => (
            <SupportTicketCard
              key={t.id}
              ticket={t}
              onPress={() => nav.navigate('TicketDetail', {ticketId: t.id})}
            />
          ))}
        </>
      )}

      <SectionTitle title="Quick answers" />
      <View style={styles.faq}>
        {FAQ.map((f, i) => {
          const expanded = open === i;
          return (
            <Pressable
              key={f.q}
              onPress={() => setOpen(expanded ? null : i)}
              accessibilityRole="button"
              accessibilityState={{expanded}}
              accessibilityLabel={f.q}
              style={styles.faqItem}>
              <View style={styles.faqHead}>
                <Text style={styles.faqQ}>{f.q}</Text>
                <Icon
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.muted}
                />
              </View>
              {expanded && <Text style={styles.faqA}>{f.a}</Text>}
            </Pressable>
          );
        })}
      </View>

      <BottomSheet
        visible={category !== null}
        onClose={reset}
        title={
          CATEGORIES.find(c => c.value === category)?.title ?? 'New ticket'
        }
        footer={
          <PrimaryButton
            label="Open ticket"
            icon="send"
            loading={busy}
            disabled={!title.trim() || !message.trim()}
            onPress={submit}
          />
        }>
        <TextField
          label="Summary"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Charger stopped at 55%"
        />
        <TextField
          label="What happened?"
          value={message}
          onChangeText={setMessage}
          placeholder="Tell us what you saw"
          multiline
        />
        {history.length > 0 && (
          <View>
            <Text style={styles.label}>Related session (optional)</Text>
            <View style={styles.chips}>
              {history.slice(0, 3).map(h => (
                <Chip
                  key={h.id}
                  label={`${h.stationName
                    .split('•')
                    .pop()
                    ?.trim()} • ${formatDate(h.startedAt)}`}
                  selected={linked === h.id}
                  onPress={() => setLinked(linked === h.id ? null : h.id)}
                />
              ))}
            </View>
          </View>
        )}
        {error && (
          <Notice tone="danger" title="Couldn’t open ticket" body={error} />
        )}
        <KeyboardSpacer />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  faq: {gap: spacing.sm},
  faqItem: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  faqHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  faqQ: {...type.bodyStrong, color: colors.ink, flex: 1},
  faqA: {
    ...type.body,
    color: colors.inkSoft,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  label: {...type.label, color: colors.ink},
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
