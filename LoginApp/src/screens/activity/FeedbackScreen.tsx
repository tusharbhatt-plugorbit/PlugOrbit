import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {DEFAULT_CENTER} from '../../config/google';
import {describeError} from '../../domain/describeError';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {
  Card,
  EmptyState,
  Icon,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextField,
  ToggleRow,
} from '../../ui';

/** 20 Feedback: did it work, how was it, and what can we confirm for the next driver. */
export default function FeedbackScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'Feedback'>();
  const {session: sessionService, station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const summary = useApp(s => s.history.find(h => h.id === params.sessionId));
  const done = useApp(s => s.feedbackDone.includes(params.sessionId));

  const [worked, setWorked] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [confirmStatus, setConfirmStatus] = useState(true);
  const [confirmPrice, setConfirmPrice] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!summary) {
    return (
      <Screen title="Feedback">
        <EmptyState
          icon="star"
          title="Nothing to rate"
          body="We couldn’t find that session."
          primary={{label: 'Go home', onPress: () => nav.reset('Home')}}
        />
      </Screen>
    );
  }

  if (thanks || done) {
    return (
      <Screen title="Feedback" hideBack stack>
        <EmptyState
          icon="circle-check"
          title="Thanks, that helps"
          body="Your check keeps statuses and prices honest for the next driver."
          primary={{
            label: 'Done',
            icon: 'check',
            onPress: () => nav.reset('Home'),
          }}
        />
      </Screen>
    );
  }

  const submit = async () => {
    if (worked === null || rating === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sessionService.feedback(summary.id, {
        chargerWorked: worked,
        rating,
        confirmedStatus: confirmStatus || confirmPrice,
      });
      if (worked && (confirmStatus || confirmPrice)) {
        // Best effort: the history keeps the station name, not its id.
        const hits = await stationService.search(
          summary.stationName,
          DEFAULT_CENTER,
          vehicle,
        );
        const hit = hits.find(s => s.name === summary.stationName);
        if (hit) {
          await stationService.confirmStatus(
            hit.id,
            confirmPrice && !confirmStatus ? 'price_confirmed' : 'working',
          );
        }
      }
      setThanks(true);
    } catch (e) {
      setError(describeError(e, 'We couldn’t send your feedback.').body);
    }
    setBusy(false);
  };

  return (
    <Screen
      title="Feedback"
      stack
      footer={
        <PrimaryButton
          label="Submit"
          icon="send"
          loading={busy}
          disabled={worked === null || rating === 0}
          onPress={submit}
        />
      }>
      <Text style={styles.lead}>How was the stop?</Text>
      <Text style={styles.sub}>{summary.stationName}</Text>

      <Card>
        <Text style={styles.q}>Did the charger work?</Text>
        <View style={styles.yesno}>
          <Choice
            label="Yes"
            icon="thumbs-up"
            active={worked === true}
            onPress={() => setWorked(true)}
          />
          <Choice
            label="No"
            icon="thumbs-down"
            active={worked === false}
            onPress={() => setWorked(false)}
          />
        </View>
        {worked === false && (
          <View style={styles.gap}>
            <Notice
              tone="warn"
              title="Sorry about that"
              body="Tell us what went wrong so we can fix it and warn other drivers."
            />
            <SecondaryButton
              label="Report a problem"
              icon="flag"
              compact
              onPress={() =>
                nav.navigate('ReportProblem', {sessionId: summary.id})
              }
            />
          </View>
        )}
      </Card>

      <Card>
        <Text style={styles.q}>Rate this stop</Text>
        <View style={styles.stars} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map(n => (
            <Pressable
              key={n}
              onPress={() => setRating(n)}
              hitSlop={6}
              accessibilityRole="radio"
              accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
              accessibilityState={{selected: rating === n}}>
              <Icon
                name="star"
                size={34}
                color={n <= rating ? colors.limeDark : colors.inputBorder}
                filled={n <= rating}
              />
            </Pressable>
          ))}
        </View>
      </Card>

      {worked === true && (
        <Card>
          <Text style={styles.q}>Confirm for the next driver</Text>
          <ToggleRow
            title="It was available as shown"
            value={confirmStatus}
            onValueChange={setConfirmStatus}
          />
          <ToggleRow
            title="The price matched"
            value={confirmPrice}
            onValueChange={setConfirmPrice}
            last
          />
        </Card>
      )}

      <TextField
        label="Anything else? (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Parking, signage, wait…"
        multiline
      />
      {error && <Notice tone="danger" title="Couldn’t send" body={error} />}
    </Screen>
  );
}

function Choice({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: 'thumbs-up' | 'thumbs-down';
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{selected: active}}
      accessibilityLabel={label}
      style={[styles.choice, active && styles.choiceOn]}>
      <Icon name={icon} size={20} color={colors.ink} />
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: {...type.display, color: colors.ink},
  sub: {...type.body, color: colors.muted, marginTop: -6},
  q: {...type.heading, color: colors.ink},
  yesno: {flexDirection: 'row', gap: spacing.md, marginTop: spacing.md},
  choice: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  choiceOn: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  choiceText: {...type.bodyStrong, color: colors.ink},
  gap: {gap: spacing.md, marginTop: spacing.md},
  stars: {flexDirection: 'row', gap: spacing.md, marginTop: spacing.md},
});
