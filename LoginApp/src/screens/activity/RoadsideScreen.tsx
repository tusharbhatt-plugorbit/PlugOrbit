import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {describeError} from '../../domain/describeError';
import {useNavigation} from '../../navigation/NavigationContext';
import {getCurrentLocation, LocationError} from '../../services/location';
import {useDemo} from '../../store/demoStore';
import {colors, spacing, type} from '../../theme';
import {IconName} from '../../ui/Icon';
import {
  BottomSheet,
  Card,
  Icon,
  ListCard,
  ListRow,
  Notice,
  Pill,
  PrimaryButton,
  Screen,
  TextField,
  ToggleRow,
} from '../../ui';
import type {Coords} from '../../utils/geo';

type Issue = {key: string; title: string; sub: string; icon: IconName};
const ISSUES: Issue[] = [
  {
    key: 'battery',
    title: 'Battery depleted',
    sub: 'Out of charge before a charger',
    icon: 'battery-warning',
  },
  {
    key: 'vehicle',
    title: 'Vehicle issue',
    sub: 'Warning light, won’t start, won’t charge',
    icon: 'wrench',
  },
  {
    key: 'tyre',
    title: 'Tyre / breakdown',
    sub: 'Puncture or mechanical failure',
    icon: 'truck',
  },
];

/**
 * 31 Roadside assistance (Later phase). The request flow is real UI; the
 * assistance network isn't connected, and the screen says so.
 * TODO(integration): roadside partner dispatch.
 */
export default function RoadsideScreen(): React.JSX.Element {
  const nav = useNavigation();
  const locationDenied = useDemo(s => s.locationDenied);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [place, setPlace] = useState<Coords | null>(null);
  const [address, setAddress] = useState('');
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (i: Issue) => {
    setIssue(i);
    setRef(null);
    setError(null);
    setLocating(true);
    setDenied(false);
    try {
      if (locationDenied) {
        throw new LocationError('denied', 'denied');
      }
      setPlace(await getCurrentLocation());
    } catch (e) {
      setPlace(null);
      setDenied(true);
      setError(describeError(e, 'We couldn’t find your location.').body);
    }
    setLocating(false);
  };

  const close = () => setIssue(null);
  const canSend = place !== null || address.trim().length > 3;

  const request = () => {
    setRef(`RS-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  return (
    <Screen title="Roadside assistance" stack>
      <Notice
        tone="info"
        title="Coming soon"
        body="Requests are recorded, but the assistance network isn’t connected in this build. In an emergency call your local emergency number."
      />
      <ListCard>
        {ISSUES.map(i => (
          <ListRow
            key={i.key}
            icon={i.icon}
            iconTone="warn"
            title={i.title}
            subtitle={i.sub}
            onPress={() => open(i)}
          />
        ))}
        <ListRow
          icon="map-pin"
          iconTone="info"
          title="Live location sharing"
          subtitle={
            sharing
              ? 'Sharing with your emergency contact'
              : 'Let someone follow your trip'
          }
          right={
            <Pill
              label={sharing ? 'On' : 'Off'}
              tone={sharing ? 'lime' : 'slate'}
            />
          }
          onPress={() => setSharing(!sharing)}
          last
        />
      </ListCard>
      <Card>
        <Text style={styles.fine}>
          Tip: low on battery? Open the map, filter to “Available” and navigate
          to the nearest compatible charger first.
        </Text>
      </Card>
      <View style={styles.center}>
        <PrimaryButton
          label="Find the nearest charger"
          icon="zap"
          compact
          onPress={() => nav.navigate('Map')}
        />
      </View>

      <BottomSheet
        visible={issue !== null}
        onClose={close}
        title={issue?.title ?? 'Request help'}
        footer={
          ref ? (
            <PrimaryButton label="Done" icon="check" onPress={close} />
          ) : (
            <PrimaryButton
              label="Request help"
              icon="send"
              disabled={!canSend || locating}
              onPress={request}
            />
          )
        }>
        {ref ? (
          <View style={styles.sent}>
            <Icon name="circle-check" size={44} color={colors.limeDark} />
            <Text style={styles.sentTitle}>Request received</Text>
            <Text style={styles.fine}>
              Reference {ref}. Assistance dispatch isn’t live in this build, so
              no one has been sent.
            </Text>
          </View>
        ) : (
          <>
            <Card tone={place ? 'lime' : 'default'}>
              <View style={styles.locRow}>
                <Icon name="map-pin" size={20} color={colors.limeDark} />
                <Text style={styles.locText}>
                  {locating
                    ? 'Finding your location…'
                    : place
                    ? `Your location: ${place.latitude.toFixed(
                        4,
                      )}, ${place.longitude.toFixed(4)}`
                    : 'We couldn’t get your location'}
                </Text>
              </View>
            </Card>
            {(denied || !place) && !locating && (
              <TextField
                label="Where are you?"
                value={address}
                onChangeText={setAddress}
                placeholder="Road, landmark or city"
                icon="map-pin"
                helper={error ?? undefined}
              />
            )}
            <ToggleRow
              title="Share live location"
              subtitle="So responders can find you"
              value={sharing}
              onValueChange={setSharing}
              last
            />

          </>
        )}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fine: {...type.caption, color: colors.muted, lineHeight: 18},
  center: {alignItems: 'center'},
  sent: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg},
  sentTitle: {...type.h1, color: colors.ink},
  locRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  locText: {...type.bodyStrong, color: colors.ink, flex: 1},
});
