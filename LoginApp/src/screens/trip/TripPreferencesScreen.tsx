import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import {reserveKm, reserveLevel} from '../../domain/socEstimate';
import type {RouteStrategy, TripPreferences} from '../../domain/types';
import {suggestionsFrom} from '../../intelligence/preferences';
import {useNavigation} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  Card,
  ListCard,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  SectionTitle,
  SegmentedControl,
  Stepper,
  TextButton,
  ToggleRow,
  showToast,
} from '../../ui';

const MIN_RESERVE = 5;
const MAX_RESERVE = 30;
const DEFAULTS: TripPreferences = {
  minArrivalSocPct: 12,
  strategy: 'reliable',
  avoidPaidParking: false,
  preferAmenities: true,
};

const STRATEGIES = [
  {value: 'fastest' as const, label: 'Fastest'},
  {value: 'cheapest' as const, label: 'Cheapest'},
  {value: 'reliable' as const, label: 'Reliable'},
];

const STRATEGY_HELP: Record<RouteStrategy, string> = {
  fastest: 'Shortest total trip time, even if a stop costs a little more.',
  cheapest: 'Lowest charging cost, which can add a short detour.',
  reliable:
    'Prefers chargers with the best success record and a fresh operator feed.',
};

/**
 * 38 Trip preferences. The safety reserve is the one that matters: it is the
 * battery the planner refuses to dip below on arrival, so it is explained in
 * kilometres, not just a percentage.
 */
export default function TripPreferencesScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {preferences, smartDrive} = useServices();
  const saved = useApp(s => s.tripPrefs);
  const sd = useApp(s => s.smartDrive);
  const vehicle = useApp(selectActiveVehicle);

  const [draft, setDraft] = useState<TripPreferences>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);

  const set = <K extends keyof TripPreferences>(
    key: K,
    value: TripPreferences[K],
  ) => {
    setDraft(d => ({...d, [key]: value}));
    setError(null);
  };

  const level = reserveLevel(draft.minArrivalSocPct);
  // What PlugOrbit noticed about how you choose. It only ever proposes: nothing
  // changes until you tap, and then it lands in the form below for you to review.
  const suggestions = suggestionsFrom(sd.signals, draft, sd.dismissed);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULTS);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await preferences.setTripPreferences(draft);
      showToast('Trip preferences saved.', 'success');
      nav.goBack();
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your preferences.'));
      setSaving(false);
    }
  };

  return (
    <Screen
      title="Trip preferences"
      footer={
        <PrimaryButton
          label={dirty ? 'Save preferences' : 'Done'}
          icon="check"
          loading={saving}
          onPress={dirty ? save : nav.goBack}
        />
      }>
      <Text style={styles.lead}>
        These guide every route and energy plan we make for you.
      </Text>

      <View style={styles.block}>
        <Card>
          <View style={styles.head}>
            <Text style={styles.cardTitle}>Minimum arrival battery</Text>
            <Pill
              label="Safety reserve"
              tone={level.tone === 'warn' ? 'amber' : level.tone}
            />
          </View>
          <View style={styles.stepper}>
            <Stepper
              label="minimum arrival battery"
              value={draft.minArrivalSocPct}
              min={MIN_RESERVE}
              max={MAX_RESERVE}
              format={v => `${v}%`}
              onChange={v => set('minArrivalSocPct', v)}
            />
          </View>
          <Text style={styles.level}>{level.label}</Text>
          <Text style={styles.explain}>
            {vehicle
              ? `Plans keep at least ${draft.minArrivalSocPct}% in your ${
                  vehicle.make
                } ${
                  vehicle.model
                } when you reach each stop and your destination. That’s about ${reserveKm(
                  vehicle,
                  draft.minArrivalSocPct,
                )} km of driving, enough to reach a backup charger if your first choice is full or offline.`
              : `Plans keep at least ${draft.minArrivalSocPct}% in the battery when you reach each stop and your destination, so you can still reach a backup charger if your first choice is full or offline.`}
          </Text>
        </Card>
      </View>

      <SectionTitle title="Route strategy" />
      <SegmentedControl
        options={STRATEGIES}
        value={draft.strategy}
        onChange={v => set('strategy', v)}
      />
      <Text style={styles.help}>{STRATEGY_HELP[draft.strategy]}</Text>

      <SectionTitle title="Along the way" />
      <ListCard>
        <ToggleRow
          title="Avoid paid parking"
          subtitle="Skip stops that charge a parking fee on top of charging."
          value={draft.avoidPaidParking}
          onValueChange={v => set('avoidPaidParking', v)}
        />
        <ToggleRow
          title="Prefer stops with amenities"
          subtitle="When options are close, pick chargers near restrooms, food or a cafe."
          value={draft.preferAmenities}
          onValueChange={v => set('preferAmenities', v)}
          last
        />
      </ListCard>

      <SectionTitle title="Smart Drive" />
      <ListCard>
        <ToggleRow
          title="Smart Drive on for new trips"
          subtitle="PlugOrbit watches your trip and handles the charging decisions."
          value={sd.prefs.enabled}
          onValueChange={v => smartDrive.setEnabled(v)}
        />
        <ToggleRow
          title="Only tell me what matters"
          subtitle="Plan changes and safety alerts only. Everything else waits in your notifications."
          value={sd.prefs.verbosity === 'minimal'}
          onValueChange={v => smartDrive.setVerbosity(v ? 'minimal' : 'calm')}
          last
        />
      </ListCard>
      <Text style={styles.help}>These save as you change them.</Text>

      {suggestions.map(s => (
        <View key={s.id} style={styles.block}>
          <Card tone="lime">
            <Text style={styles.cardTitle}>{s.title}</Text>
            <Text style={styles.suggestBody}>{s.detail}</Text>
            <View style={styles.suggestActions}>
              <TextButton
                label="Not now"
                tone="muted"
                onPress={() => smartDrive.dismissSuggestion(s.id)}
              />
              <PrimaryButton
                label="Use this"
                compact
                onPress={() => setDraft(d => ({...d, ...s.apply}))}
              />
            </View>
          </Card>
        </View>
      ))}

      {error && (
        <View style={styles.block}>
          <Notice
            tone={errorTone(error)}
            title={error.title}
            body={error.body}
          />
        </View>
      )}

      {!isDefault && (
        <View style={styles.reset}>
          <TextButton
            label="Reset to recommended"
            icon="refresh-cw"
            onPress={() => {
              setDraft(DEFAULTS);
              setError(null);
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.body, color: colors.muted},
  block: {marginTop: spacing.lg},
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {...type.heading, color: colors.ink, flex: 1},
  stepper: {alignItems: 'center', marginTop: spacing.lg},
  level: {
    ...type.label,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  explain: {
    ...type.caption,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 18,
    textAlign: 'center',
  },
  help: {...type.caption, color: colors.muted, marginTop: spacing.sm},
  suggestBody: {
    ...type.caption,
    color: colors.inkSoft,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  suggestActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  reset: {alignItems: 'center', marginTop: spacing.lg},
});
