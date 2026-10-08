import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {timeAgo} from '../../domain/trust';
import type {CommunityUpdate} from '../../domain/types';
import {useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {colors, radii, spacing, type} from '../../theme';
import {
  AsyncView,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconName,
  Notice,
  Pill,
  Screen,
  showToast,
  useNow,
  useResource,
} from '../../ui';

const ACTIONS: ReadonlyArray<{
  kind: CommunityUpdate['kind'];
  label: string;
  icon: IconName;
}> = [
  {kind: 'working', label: 'Working', icon: 'circle-check'},
  {kind: 'bay_blocked', label: 'Bay blocked', icon: 'siren'},
  {kind: 'price_confirmed', label: 'Price confirmed', icon: 'indian-rupee'},
  {kind: 'busy', label: 'Busy', icon: 'users'},
];

const KIND_ICON: Record<
  CommunityUpdate['kind'],
  {icon: IconName; bg: string; fg: string}
> = {
  working: {icon: 'circle-check', bg: colors.limeSoft, fg: colors.limeDark},
  bay_blocked: {icon: 'siren', bg: colors.amberSoft, fg: colors.amber},
  price_confirmed: {icon: 'indian-rupee', bg: colors.infoSoft, fg: colors.info},
  busy: {icon: 'users', bg: colors.slateSoft, fg: colors.inkSoft},
};

/** 36 Community updates: what drivers just saw. Always shown as user-confirmed, with age. */
export default function CommunityScreen(): React.JSX.Element {
  const {params} = useRoute<'Community'>();
  const {station: stationService} = useServices();
  const now = useNow(30_000);
  const station = useResource(
    () => stationService.get(params.stationId),
    [params.stationId],
  );
  const res = useResource(
    () => stationService.community(params.stationId),
    [params.stationId],
  );
  const [mine, setMine] = useState<CommunityUpdate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (kind: CommunityUpdate['kind']) => {
    setBusy(kind);
    setError(null);
    try {
      const update = await stationService.confirmStatus(params.stationId, kind);
      setMine(prev => [update, ...prev]);
      showToast('Thanks, your check is on the list.', 'success');
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your check.').body);
    }
    setBusy(null);
  };

  return (
    <Screen title="Community updates" stack>
      <Text style={styles.lead}>Latest station checks</Text>
      {station.data && <Text style={styles.sub}>{station.data.name}</Text>}

      <Card>
        <Text style={styles.label}>Been here? Confirm what you saw</Text>
        <View style={styles.chips}>
          {ACTIONS.map(a => (
            <Chip
              key={a.kind}
              label={busy === a.kind ? 'Saving…' : a.label}
              icon={a.icon}
              onPress={() => confirm(a.kind)}
            />
          ))}
        </View>
      </Card>
      {error && <Notice tone="danger" title="Couldn’t save" body={error} />}

      <AsyncView
        resource={res}
        errorTitle="Couldn’t load updates"
        isEmpty={d => d.length + mine.length === 0}
        empty={
          <EmptyState
            icon="users"
            title="No checks yet"
            body="Be the first to confirm what you see here."
            compact
          />
        }
        render={list => (
          <View style={styles.list}>
            {[...mine, ...list].map(u => {
              const k = KIND_ICON[u.kind];
              return (
                <View key={u.id} style={styles.item}>
                  <View style={[styles.icon, {backgroundColor: k.bg}]}>
                    <Icon name={k.icon} size={18} color={k.fg} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.text}>{u.text}</Text>
                    <Text style={styles.time}>{timeAgo(u.at, now)}</Text>
                  </View>
                  {u.userConfirmed && (
                    <Pill label="User-confirmed" tone="info" />
                  )}
                </View>
              );
            })}
          </View>
        )}
      />
      <Text style={styles.fine}>
        These are reports from drivers, not the operator. They’re never shown as
        LIVE.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  lead: {...type.display, color: colors.ink},
  sub: {...type.body, color: colors.muted, marginTop: -6},
  label: {...type.label, color: colors.ink},
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  list: {gap: spacing.sm},
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {...type.bodyStrong, color: colors.ink},
  time: {...type.caption, color: colors.muted, marginTop: 2},
  fine: {...type.caption, color: colors.muted},
});
