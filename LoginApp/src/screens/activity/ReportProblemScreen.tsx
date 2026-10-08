import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {DEFAULT_CENTER} from '../../config/google';
import {describeError} from '../../domain/describeError';
import type {ProblemKind} from '../../domain/types';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {
  AsyncView,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconName,
  Notice,
  PrimaryButton,
  Screen,
  TextField,
  ToggleRow,
  useResource,
} from '../../ui';

const KINDS: ReadonlyArray<{
  kind: ProblemKind;
  label: string;
  hint: string;
  icon: IconName;
}> = [
  {
    kind: 'offline',
    label: 'Charger is offline',
    hint: 'Shown as available but it won’t respond',
    icon: 'zap-off',
  },
  {
    kind: 'broken_connector',
    label: 'Broken connector',
    hint: 'Damaged plug, cable or latch',
    icon: 'plug-zap',
  },
  {
    kind: 'wrong_price',
    label: 'Wrong price',
    hint: 'Different from what the app showed',
    icon: 'indian-rupee',
  },
  {
    kind: 'access_blocked',
    label: 'Access blocked',
    hint: 'A car in the bay, gate closed',
    icon: 'siren',
  },
  {
    kind: 'other',
    label: 'Something else',
    hint: 'Tell us in your own words',
    icon: 'message-circle',
  },
];

/** 21 Report a problem. Goes to the station's record and opens a support ticket. */
export default function ReportProblemScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'ReportProblem'>();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);

  const [stationId, setStationId] = useState<string | null>(
    params?.stationId ?? null,
  );
  const [kind, setKind] = useState<ProblemKind | null>(null);
  const [note, setNote] = useState(
    params?.sessionId ? `Session ${params.sessionId}: ` : '',
  );
  const [photo, setPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  // Only needed when we weren't told which station.
  const nearby = useResource(
    () => stationService.nearby({origin: DEFAULT_CENTER, vehicle}),
    [vehicle?.id],
    {
      enabled: !stationId,
    },
  );
  const chosen = useResource(
    () => stationService.get(stationId as string),
    [stationId],
    {enabled: !!stationId},
  );

  if (ticketId) {
    return (
      <Screen title="Report a problem" hideBack stack>
        <EmptyState
          icon="circle-check"
          title="Report sent"
          body="Thanks. We’ve flagged this charger and opened a ticket so you can follow it."
          primary={{
            label: 'View ticket',
            icon: 'message-circle',
            onPress: () => nav.replace('TicketDetail', {ticketId}),
          }}
          secondary={{label: 'Done', onPress: () => nav.goBack()}}
        />
      </Screen>
    );
  }

  const submit = async () => {
    if (!stationId || !kind) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const {ticketId: id} = await stationService.report({
        stationId,
        kind,
        note: note.trim(),
        hasPhoto: photo,
      });
      setTicketId(id);
    } catch (e) {
      setError(describeError(e, 'We couldn’t send your report.').body);
    }
    setBusy(false);
  };

  return (
    <Screen
      title="Report a problem"
      stack
      footer={
        <PrimaryButton
          label="Send report"
          icon="send"
          loading={busy}
          disabled={!stationId || !kind}
          onPress={submit}
        />
      }>
      <Text style={styles.lead}>What’s wrong?</Text>

      <Card>
        <Text style={styles.label}>Station</Text>
        {stationId ? (
          <AsyncView
            resource={chosen}
            loading={<Text style={styles.sub}>Loading…</Text>}
            render={s => (
              <View style={styles.stationRow}>
                <Text style={styles.stationName}>{s.name}</Text>
                {!params?.stationId && (
                  <Chip label="Change" onPress={() => setStationId(null)} />
                )}
              </View>
            )}
          />
        ) : (
          <AsyncView
            resource={nearby}
            render={list => (
              <View style={styles.chips}>
                {list.slice(0, 6).map(s => (
                  <Chip
                    key={s.id}
                    label={s.name}
                    onPress={() => setStationId(s.id)}
                  />
                ))}
              </View>
            )}
          />
        )}
      </Card>

      <View style={styles.options}>
        {KINDS.map(o => {
          const active = kind === o.kind;
          return (
            <Pressable
              key={o.kind}
              onPress={() => setKind(o.kind)}
              accessibilityRole="radio"
              accessibilityState={{selected: active}}
              accessibilityLabel={`${o.label}. ${o.hint}`}
              style={[styles.option, active && styles.optionOn]}>
              <View style={styles.optionIcon}>
                <Icon name={o.icon} size={20} color={colors.ink} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.optionTitle}>{o.label}</Text>
                <Text style={styles.sub}>{o.hint}</Text>
              </View>
              <View style={[styles.radio, active && styles.radioOn]}>
                {active && (
                  <Icon
                    name="check"
                    size={13}
                    color={colors.ink}
                    strokeWidth={3}
                  />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label="Details (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="What did you see?"
        multiline
      />

      <Card>
        {/* TODO(integration): image picker + upload; this records the intent only. */}
        <ToggleRow
          title="Add a photo"
          subtitle="Helps us fix it faster"
          value={photo}
          onValueChange={setPhoto}
          last
        />
      </Card>

      {error && <Notice tone="danger" title="Couldn’t send" body={error} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  lead: {...type.display, color: colors.ink},
  label: {...type.label, color: colors.muted},
  sub: {...type.caption, color: colors.muted},
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  stationName: {...type.heading, color: colors.ink, flex: 1},
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  options: {gap: spacing.sm},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    minHeight: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionOn: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {...type.bodyStrong, color: colors.ink},
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {backgroundColor: colors.lime, borderColor: colors.lime},
});
