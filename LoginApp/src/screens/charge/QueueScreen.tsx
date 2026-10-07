import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {CONFIDENCE_LABEL, waitBasisLabel, waitLabel} from '../../domain/rules';
import {describeError} from '../../domain/describeError';
import {stationErrorProps} from '../../hooks/useDiscoverStations';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {DEFAULT_CENTER} from '../../config/google';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  AsyncView,
  Card,
  ConfidencePill,
  Icon,
  KeyValue,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  showToast,
  useResource,
} from '../../ui';
import {ConfirmActionSheet} from '../../ui/ConfirmActionSheet';

/**
 * 27 Queue status. The wait is always a range with a confidence label, never a
 * single number. TODO(integration): operator queue API.
 */
export default function QueueScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Queue'>();
  const {station: stationService} = useServices();
  const queue = useApp(s => s.queue);
  const vehicle = useApp(selectActiveVehicle);
  const mine = queue && queue.stationId === params.stationId ? queue : null;

  const stationRes = useResource(
    () => stationService.get(params.stationId),
    [params.stationId],
  );
  const waitRes = useResource(
    () => stationService.waitEstimate(params.stationId, vehicle),
    [params.stationId, vehicle?.id ?? null],
    {enabled: !mine},
  );

  // "A bay is free" is only ever claimed from a live operator feed.
  const bayFree =
    !mine &&
    waitRes.data !== null &&
    waitRes.data.maxMinutes === 0 &&
    waitRes.data.basis === 'live_queue';

  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await stationService.joinQueue(params.stationId);
      showToast(
        'You’re in the queue. We’ll alert you when it’s your turn.',
        'success',
      );
    } catch (e) {
      setError(describeError(e, 'We couldn’t add you to the queue.').body);
    }
    setBusy(false);
  };

  const leave = async () => {
    setBusy(true);
    try {
      await stationService.leaveQueue();
      showToast('You left the queue.', 'info');
      setLeaving(false);
      nav.goBack();
    } catch (e) {
      setError(describeError(e, 'We couldn’t remove you from the queue.').body);
    }
    setBusy(false);
  };

  const openBackup = async () => {
    if (!mine) {
      return;
    }
    try {
      const found = await stationService.search(
        mine.backupStationName,
        DEFAULT_CENTER,
        vehicle,
      );
      const hit =
        found.find(s => s.name === mine.backupStationName) ?? found[0];
      if (hit) {
        nav.replace('StationDetail', {stationId: hit.id});
      } else {
        nav.navigate('StationList');
      }
    } catch {
      nav.navigate('StationList');
    }
  };

  return (
    <Screen
      title="Queue status"
      stack
      footer={
        mine ? (
          <SecondaryButton
            label="Leave queue"
            tone="danger"
            icon="log-out"
            onPress={() => setLeaving(true)}
          />
        ) : bayFree ? (
          <>
            <PrimaryButton
              label="Go to this charger"
              icon="send"
              onPress={() =>
                nav.replace('Navigation', {stationId: params.stationId})
              }
            />
            <SecondaryButton
              label="Join queue anyway"
              icon="users"
              loading={busy}
              onPress={join}
            />
          </>
        ) : (
          <PrimaryButton
            label="Join queue"
            icon="users"
            loading={busy}
            onPress={join}
          />
        )
      }>
      {mine ? (
        <>
          <Card tone="dark">
            <Text style={styles.kicker}>Your place</Text>
            <Text style={styles.position}>#{mine.position} in queue</Text>
            <Text style={styles.station}>{mine.stationName}</Text>
          </Card>
          <Card>
            <KeyValue
              label="Expected wait"
              value={waitLabel(mine.wait)}
              emphasis
            />
            <View style={styles.pillRow}>
              <ConfidencePill confidence={mine.wait.confidence} />
            </View>
            <Text style={styles.fine}>
              {waitBasisLabel(mine.wait)} It’s a range, not a promise.{' '}
              {CONFIDENCE_LABEL[mine.wait.confidence]}.
            </Text>
          </Card>
          <Card>
            <View style={styles.backup}>
              <Icon name="shield-check" size={20} color={colors.info} />
              <View style={styles.flex}>
                <Text style={styles.backupTitle}>
                  Backup: {mine.backupStationName}
                </Text>
                <Text style={styles.fine}>
                  +{mine.backupExtraMin} min detour if this queue grows
                </Text>
              </View>
            </View>
            <View style={styles.backupBtn}>
              <SecondaryButton
                label="Switch to backup"
                icon="repeat"
                compact
                onPress={openBackup}
              />
            </View>
          </Card>
        </>
      ) : (
        <AsyncView
          resource={stationRes}
          {...stationErrorProps(stationRes.error, 'Couldn’t load this charger')}
          render={station => (
            <>
              <Text style={styles.lead}>Join the queue</Text>
              <Text style={styles.sub}>{station.name}</Text>
              <Card>
                <AsyncView
                  resource={waitRes}
                  render={w => (
                    <>
                      <KeyValue
                        label="Expected wait"
                        value={waitLabel(w)}
                        emphasis
                      />
                      <View style={styles.pillRow}>
                        <ConfidencePill confidence={w.confidence} />
                      </View>
                      <Text style={styles.fine}>{waitBasisLabel(w)}</Text>
                    </>
                  )}
                />
              </Card>
              {bayFree ? (
                <Notice
                  tone="lime"
                  title="A bay is free right now"
                  body="No need to queue. Head there and start charging, or join anyway to hold your place if it fills up."
                />
              ) : (
                <Notice
                  tone="info"
                  title="You’ll keep your place"
                  body="We’ll alert you when a bay frees up. Leave any time; there’s no charge for queuing."
                />
              )}
              {error && (
                <Notice tone="danger" title="Couldn’t join" body={error} />
              )}
            </>
          )}
        />
      )}
      <ConfirmActionSheet
        visible={leaving}
        title="Leave the queue?"
        body="You’ll lose your place. You can join again, but you’d go to the back."
        confirmLabel="Leave queue"
        cancelLabel="Stay"
        tone="danger"
        loading={busy}
        onConfirm={leave}
        onCancel={() => setLeaving(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  lead: {...type.h1, color: colors.ink},
  sub: {...type.body, color: colors.muted},
  kicker: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  position: {
    fontSize: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 6,
    letterSpacing: -1,
  },
  station: {...type.body, color: colors.chipText, marginTop: 4},
  pillRow: {flexDirection: 'row', marginTop: spacing.sm},
  fine: {...type.caption, color: colors.muted, marginTop: spacing.sm},
  backup: {flexDirection: 'row', gap: spacing.md, alignItems: 'center'},
  backupTitle: {...type.bodyStrong, color: colors.ink},
  backupBtn: {marginTop: spacing.md},
});
