import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {DEFAULT_SMART_DRIVE_CONFIG} from '../../intelligence/config';
import {PHRASES, kmLabel, pctLabel} from '../../intelligence/copy';
import {QUESTIONS} from '../../intelligence/explain';
import type {CopilotAnswer, QuestionId} from '../../intelligence/explain';
import {outlookAtArrival} from '../../intelligence/wait';
import {
  useIsActiveRef,
  useNavigation,
} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {openDirections} from '../../services/directions';
import {selectActiveVehicle, selectTrip, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {formatClock} from '../../utils/format';
import {
  BackupChargerCard,
  Card,
  Chip,
  CostBreakdown,
  EmptyState,
  KeyValue,
  ListCard,
  ListRow,
  Notice,
  Pill,
  PrimaryButton,
  ReasonList,
  RuledOutNote,
  Screen,
  SectionTitle,
  StopBreakdown,
  StopSummaryCard,
  showToast,
  useTripNow,
} from '../../ui';

const OUTLOOK_WORDS = {
  likely_available: 'Likely free when you get there',
  uncertain: 'Hard to say yet',
  likely_busy: 'Likely busy when you get there',
} as const;

/**
 * Why this charger, what it costs in minutes and rupees, how it fits THIS car,
 * and a way to ask the co-pilot about it. Everything here explains a decision
 * the engines already made; none of it can override a safety rule.
 */
export default function SmartDriveStopScreen(): React.JSX.Element {
  const nav = useNavigation();
  const active = useIsActiveRef();
  const {smartDrive} = useServices();
  const trip = useApp(selectTrip);
  const vehicle = useApp(selectActiveVehicle);
  const now = useTripNow(trip?.clockOffsetMs, 15_000);

  const [asked, setAsked] = useState<QuestionId | null>(null);
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = trip?.plan.primary ?? null;
  if (!trip || !stop) {
    return (
      <Screen title="Your charging stop">
        <EmptyState
          icon="sparkles"
          title={trip ? 'No charging stop needed' : 'No trip in progress'}
          body={
            trip
              ? `Your battery covers the trip. ${PHRASES.noActionNeeded}`
              : 'Start Smart Drive and we’ll pick your stop and a backup before you need them.'
          }
          primary={{
            label: trip ? 'Back to your trip' : 'Start Smart Drive',
            icon: 'sparkles',
            onPress: () => nav.replace('SmartDrive'),
          }}
        />
      </Screen>
    );
  }

  const m = stop.metrics;
  const outlook = outlookAtArrival(
    stop.station,
    vehicle,
    now,
    m.etaAt,
    DEFAULT_SMART_DRIVE_CONFIG,
  );
  const backup = trip.plan.backup;

  const ask = async (q: QuestionId) => {
    setAsked(q);
    setError(null);
    try {
      const a = await smartDrive.ask(q);
      if (active.current) {
        setAnswer(a);
      }
    } catch (e) {
      if (active.current) {
        setError(describeError(e, 'I couldn’t answer that just now.').body);
      }
    }
  };

  const switchTo = async (stationId: string, name: string) => {
    setBusy(stationId);
    setError(null);
    try {
      await smartDrive.switchTo(stationId);
      showToast(`Switched to ${name}.`, 'success');
      if (active.current) {
        setAnswer(null);
        setAsked(null);
      }
    } catch (e) {
      if (active.current) {
        setError(describeError(e, 'We couldn’t switch.').body);
      }
    }
    if (active.current) {
      setBusy(null);
    }
  };

  const navigate = async () => {
    const ok = await openDirections(stop.station);
    if (!ok) {
      showToast('Couldn’t open Google Maps. Is it installed?', 'warn');
    }
  };

  return (
    <Screen
      title="Your charging stop"
      stack
      footer={
        <PrimaryButton
          label="Navigate to this stop"
          icon="navigation"
          onPress={navigate}
        />
      }>
      <StopSummaryCard
        stop={stop}
        backup={backup}
        vehicle={vehicle}
        now={now}
      />

      <SectionTitle title="Charger and your car" />
      <Card>
        <KeyValue label="Charger capability" value={`${m.chargerKw} kW`} />
        <KeyValue
          label="Expected for your car"
          value={`~${m.expectedKw} kW`}
          emphasis
        />
        <KeyValue
          label="You’ll arrive with"
          value={`~${pctLabel(m.arriveSoc.expected)}`}
        />
        <KeyValue label="Charge to" value={`${pctLabel(m.targetSoc)}`} last />
        <Text style={styles.fine}>
          {m.targetReason === 'finish_trip'
            ? `That’s enough to finish your trip with ${trip.reservePct}% to spare.`
            : m.targetReason === 'reach_next_stop'
            ? 'That’s enough to reach your next stop comfortably.'
            : 'As much as is sensible here; the options beyond it are limited.'}
          {m.savedVsCapMin
            ? ` Stopping there instead of ${DEFAULT_SMART_DRIVE_CONFIG.maxChargeToPct}% saves about ${m.savedVsCapMin} min.`
            : ''}
        </Text>
      </Card>

      <SectionTitle title="Time at the stop" />
      <StopBreakdown metrics={m} />

      <SectionTitle title="What it costs" />
      <CostBreakdown metrics={m} />

      <SectionTitle title="When you arrive" />
      <Card>
        <KeyValue label="Expected arrival" value={formatClock(m.etaAt)} />
        <KeyValue
          label="Right now"
          value={
            outlook.currentAvailability === 'available'
              ? 'A bay is free'
              : outlook.currentAvailability === 'occupied'
              ? 'All bays busy'
              : outlook.currentAvailability === 'offline'
              ? 'Offline'
              : 'Unknown'
          }
        />
        <View style={styles.outlookRow}>
          <Text style={styles.outlookText}>
            {outlook.predictedAvailabilityAtArrival
              ? OUTLOOK_WORDS[outlook.predictedAvailabilityAtArrival]
              : 'Too far ahead to say'}
          </Text>
          {outlook.predictionConfidence && (
            <Pill
              label={`${
                outlook.predictionConfidence[0].toUpperCase() +
                outlook.predictionConfidence.slice(1)
              } confidence`}
              tone={outlook.predictionConfidence === 'high' ? 'lime' : 'slate'}
            />
          )}
        </View>
        <Text style={styles.fine}>
          {outlook.basis === 'rules'
            ? 'A read of the current status, not a prediction model. It gets less sure the further ahead it looks.'
            : 'We don’t guess this far ahead.'}
        </Text>
      </Card>

      <SectionTitle title="Why this charger?" />
      <ReasonList stop={stop} />
      <RuledOutNote trip={trip} />

      {backup && (
        <>
          <SectionTitle title="If it doesn’t work out" />
          <BackupChargerCard
            station={{
              ...backup.station,
              distanceKm: backup.metrics.distanceFromDriverKm,
              detourMin: backup.metrics.detourMin,
            }}
            vehicle={vehicle}
            now={now}
            extraMin={backup.extraMin}
            title="Backup"
          />
          <Text style={styles.fine}>
            {backup.independent
              ? 'A different operator on a different site, so one outage can’t take out both.'
              : 'It shares a site or operator with your main stop.'}{' '}
            You’d reach it with about {pctLabel(backup.fromPrimarySoc.expected)}
            .
          </Text>
        </>
      )}

      {trip.plan.alternatives.length > 0 && (
        <>
          <SectionTitle title="Other safe options" />
          <ListCard>
            {trip.plan.alternatives.map((a, i, arr) => (
              <ListRow
                key={a.station.id}
                icon="plug-zap"
                title={a.station.name}
                subtitle={`${kmLabel(a.metrics.distanceFromDriverKm)} ahead • ${
                  a.metrics.cost.totalInr === null
                    ? 'price not published'
                    : `~₹${a.metrics.cost.totalInr}`
                }`}
                right={
                  <Pill
                    label={busy === a.station.id ? 'Switching…' : 'Switch'}
                    tone="slate"
                  />
                }
                onPress={() => switchTo(a.station.id, a.station.name)}
                last={i === arr.length - 1}
              />
            ))}
          </ListCard>
        </>
      )}

      <SectionTitle title="Ask PlugOrbit" />
      <View style={styles.chips}>
        {QUESTIONS.map(q => (
          <Chip
            key={q.id}
            label={q.label}
            selected={asked === q.id}
            onPress={() => ask(q.id)}
          />
        ))}
      </View>
      {answer && (
        <Card tone="lime">
          <Text style={styles.answer}>{answer.text}</Text>
          {answer.action && (
            <PrimaryButton
              label={answer.action.label}
              compact
              icon="repeat"
              loading={busy === answer.action.stationId}
              onPress={() => {
                const target = answer.action;
                if (target) {
                  switchTo(
                    target.stationId,
                    target.label.replace('Switch to ', ''),
                  );
                }
              }}
              style={styles.answerBtn}
            />
          )}
          <Text style={styles.fine}>
            Answers come from the same plan your stop was chosen from. They
            explain it; they can’t change what’s safe.
          </Text>
        </Card>
      )}
      {error && <Notice tone="danger" title="Couldn’t do that" body={error} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fine: {
    ...type.caption,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  outlookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    flexWrap: 'wrap',
  },
  outlookText: {...type.bodyStrong, color: colors.ink, flexShrink: 1},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  answer: {...type.body, color: colors.ink, lineHeight: 21},
  answerBtn: {marginTop: spacing.md},
});
