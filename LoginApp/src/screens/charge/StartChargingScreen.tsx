import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  energyToCharge,
  estimatePreauthInr,
  invoiceFor,
  minutesToCharge,
} from '../../domain/charging';
import {describeError} from '../../domain/describeError';
import {
  compatibleConnectors,
  connectorStatusLabel,
  effectivePowerKw,
} from '../../domain/rules';
import type {
  PaymentMethod,
  StationConnector,
  StationWithDistance,
} from '../../domain/types';
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from '../../navigation/NavigationContext';
import {resumeSession} from '../../app/initialStack';
import {useServices} from '../../services';
import {openDirections} from '../../services/directions';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import {useDemo} from '../../store/demoStore';
import {colors, radii, spacing, type} from '../../theme';
import {formatDuration, formatInr} from '../../utils/format';
import {
  AsyncView,
  Card,
  ConfidenceBadge,
  ConnectorChip,
  KeyValue,
  Notice,
  PaymentMethodCard,
  PercentSlider,
  PriceLine,
  PrimaryButton,
  Screen,
  SectionTitle,
  SecondaryButton,
  StatusBadge,
  TextButton,
  showToast,
  useNow,
  useResource,
} from '../../ui';

const REFRESH_MS = 20_000;

/**
 * 13 Start charging. The remote start rules live here: a validated payment
 * method plus a successful pre-authorisation, and only on integrated stations
 * with the operator link up. Anything else hands over to the operator's own
 * flow and never pretends PlugOrbit controls the charger.
 */
export default function StartChargingScreen(): React.JSX.Element {
  const {params} = useRoute<'StartCharging'>();
  const {station: stationService} = useServices();
  const focused = useIsFocused();

  const res = useResource(
    () => stationService.get(params.stationId),
    [params.stationId],
  );

  // Keep the connector status honest while the driver reads the screen.
  const {reload} = res;
  useEffect(() => {
    if (!focused) {
      return;
    }
    const id = setInterval(reload, REFRESH_MS);
    return () => clearInterval(id);
  }, [focused, reload]);

  if (res.data) {
    return (
      <StartForm
        station={res.data}
        connectorId={params.connectorId}
        onRefresh={res.reload}
      />
    );
  }
  return (
    <Screen title="Start charging">
      <AsyncView
        resource={res}
        loading={<LoadingBody />}
        errorTitle="Couldn’t load this charger"
        render={() => null}
      />
    </Screen>
  );
}

function LoadingBody() {
  return (
    <View style={styles.loading}>
      <Card>
        <Text style={styles.muted}>Checking the charger…</Text>
      </Card>
    </View>
  );
}

function StartForm({
  station,
  connectorId,
  onRefresh,
}: {
  station: StationWithDistance;
  connectorId: string;
  onRefresh: () => void;
}) {
  const nav = useNavigation();
  const now = useNow();
  const {session: sessionService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const methods = useApp(s => s.paymentMethods);
  const integrationDown = useDemo(s => s.integrationDown);

  const usable = useMemo(
    () => compatibleConnectors(station, vehicle),
    [station, vehicle],
  );
  const [selectedId, setSelectedId] = useState(connectorId);
  const connector: StationConnector | undefined =
    usable.find(c => c.id === selectedId) ?? usable[0];

  const validated = useMemo(() => methods.filter(m => m.validated), [methods]);
  const defaultMethod =
    validated.find(m => m.isDefault) ?? validated[0] ?? null;
  const [methodId, setMethodId] = useState<string | null>(
    defaultMethod?.id ?? null,
  );
  const method: PaymentMethod | null =
    validated.find(m => m.id === methodId) ?? defaultMethod;

  const startSoc = Math.round(battery?.percent ?? 0);
  const [target, setTarget] = useState(80);
  const minTarget = Math.min(100, Math.max(startSoc + 5, 20));
  const targetSoc = Math.max(target, minTarget);

  const [starting, setStarting] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [formError, setFormError] = useState<{
    title: string;
    body: string;
    kind: string;
  } | null>(null);

  const external = station.integration === 'external';

  // ---- No remote start: hand over to the operator, honestly ----------------
  if (external || integrationDown || handoff) {
    return (
      <Screen title="Start charging">
        <OperatorHandoff
          station={station}
          reason={
            external
              ? null
              : handoff ??
                'Remote start is temporarily unavailable for this charger.'
          }
        />
      </Screen>
    );
  }

  if (!vehicle) {
    return (
      <Screen title="Start charging">
        <View style={styles.pad}>
          <Notice
            tone="warn"
            title="Add your car first"
            body="We need your car to check this connector fits and to estimate the charge."
            action={
              <TextButton
                label="Add your EV"
                onPress={() => nav.navigate('VehicleSetup')}
              />
            }
          />
        </View>
      </Screen>
    );
  }
  if (!connector) {
    return (
      <Screen title="Start charging">
        <View style={styles.pad}>
          <Notice
            tone="danger"
            title="No connector here fits your car"
            body="This station has no connector your car can use. Pick another charger."
            action={
              <TextButton
                label="See nearby chargers"
                onPress={() => nav.navigate('StationList')}
              />
            }
          />
        </View>
      </Screen>
    );
  }

  const free = connector.status === 'available';
  const freeOthers = usable.filter(
    c => c.id !== connector.id && c.status === 'available',
  );
  const price = connector.pricePerKwh;
  const power = effectivePowerKw(connector, vehicle);
  const kwh = energyToCharge(startSoc, targetSoc, vehicle.batteryKwh);
  const minutes = minutesToCharge(
    startSoc,
    targetSoc,
    power,
    vehicle.batteryKwh,
  );
  const cost = price === null ? null : invoiceFor(kwh, price).totalInr;
  const hold =
    price === null
      ? null
      : estimatePreauthInr(startSoc, targetSoc, vehicle.batteryKwh, price);

  const ready =
    free && method !== null && price !== null && battery !== null && !starting;

  const start = async () => {
    if (!ready || !method || price === null) {
      return;
    }
    setStarting(true);
    setFormError(null);
    try {
      await sessionService.start({
        stationId: station.id,
        connectorId: connector.id,
        targetSoc,
        paymentMethodId: method.id,
      });
      showToast('Charging started.', 'success');
      nav.replace('ActiveSession');
    } catch (e) {
      const copy = describeError(e, 'We couldn’t start this charger.');
      if (copy.kind === 'integration') {
        setHandoff(copy.body);
      } else {
        setFormError({title: copy.title, body: copy.body, kind: copy.kind});
        if (copy.kind === 'connector') {
          onRefresh();
        }
      }
      setStarting(false);
    }
  };

  const footer = (
    <>
      <PrimaryButton
        label="Authorise & start"
        icon="zap"
        loading={starting}
        disabled={!ready}
        onPress={start}
        accessibilityHint="Holds a pre-authorisation and starts the charger"
      />
      {!ready && !starting && (
        <Text style={styles.ctaHint}>
          {!free
            ? 'Choose a free connector to continue.'
            : method === null
            ? 'Add a verified payment method to continue.'
            : battery === null
            ? 'Set your battery level to continue.'
            : price === null
            ? 'This connector has no published price.'
            : ''}
        </Text>
      )}
    </>
  );

  return (
    <Screen title="Start charging" footer={footer}>
      <View style={styles.scroll}>
        <Card tone="dark">
          <Text style={styles.heroLabel}>You’re about to start</Text>
          <Text style={styles.heroTitle}>
            Connector {connector.label} • {connector.type}
          </Text>
          <Text style={styles.heroSub}>
            {station.name} • {connector.powerKw} kW
          </Text>
          <View style={styles.badges}>
            <StatusBadge status={connector.status} />
            <ConfidenceBadge
              feed={station.statusFeed}
              now={now}
              subject="Status"
            />
          </View>
        </Card>

        {usable.length > 1 && (
          <View style={styles.chips}>
            {usable.map(c => (
              <ConnectorChip
                key={c.id}
                connector={c}
                selected={c.id === connector.id}
                onPress={() => {
                  setSelectedId(c.id);
                  setFormError(null);
                }}
              />
            ))}
          </View>
        )}

        {!free && (
          <Notice
            tone="warn"
            title={`${connector.label} is ${connectorStatusLabel(
              connector.status,
            ).toLowerCase()}`}
            body={
              freeOthers.length > 0
                ? 'Pick a free connector below, or choose another charger.'
                : 'No connector that fits your car is free right now.'
            }
            action={
              <View style={styles.noticeActions}>
                {freeOthers.map(c => (
                  <TextButton
                    key={c.id}
                    label={`Use ${c.label} (${c.powerKw} kW)`}
                    onPress={() => setSelectedId(c.id)}
                  />
                ))}
                {freeOthers.length === 0 && (
                  <>
                    <TextButton
                      label="Join the queue"
                      onPress={() =>
                        nav.navigate('Queue', {stationId: station.id})
                      }
                    />
                    <TextButton
                      label="See other chargers"
                      onPress={() => nav.navigate('StationList')}
                    />
                  </>
                )}
              </View>
            }
          />
        )}

        <Card>
          <KeyValue
            label="Price"
            value={
              price === null
                ? 'Not published'
                : `${formatInr(price, price % 1 !== 0)}/kWh`
            }
            emphasis
          />
          <KeyValue
            label="Idle fee"
            value={
              connector.idleFeePerMin === null
                ? '—'
                : `${formatInr(connector.idleFeePerMin)}/min after charging`
            }
            last
          />
          <View style={styles.priceAge}>
            <PriceLine station={station} vehicle={vehicle} now={now} />
          </View>
        </Card>

        <SectionTitle title="Charge to" />
        {battery === null ? (
          <Notice
            tone="warn"
            title="Set your battery level"
            body="We use it to size the pre-authorisation and estimate the time."
            action={
              <TextButton
                label="Set battery"
                onPress={() => nav.navigate('ManualSoc')}
              />
            }
          />
        ) : (
          <Card>
            <View style={styles.targetHead}>
              <Text style={styles.targetValue}>{targetSoc}%</Text>
              <Text style={styles.muted}>from {startSoc}% now</Text>
            </View>
            <PercentSlider
              label="Target battery"
              value={targetSoc}
              min={minTarget}
              max={100}
              step={5}
              onChange={setTarget}
            />
            <View style={styles.estimates}>
              <Estimate label="Energy" value={`${kwh.toFixed(1)} kWh`} />
              <Estimate label="Time" value={`~${formatDuration(minutes)}`} />
              <Estimate
                label="Cost"
                value={cost === null ? '—' : `≈ ${formatInr(cost)}`}
              />
            </View>
            <Text style={styles.fine}>
              Estimates include 18% GST. Charging slows near full, so time is
              approximate.
            </Text>
          </Card>
        )}

        <SectionTitle title="Pay with" />
        {validated.length === 0 ? (
          <Notice
            tone="danger"
            title="Add a verified payment method"
            body="PlugOrbit can only start a charger when a payment method is verified, so you're never charged by surprise."
            action={
              <TextButton
                label="Add payment method"
                onPress={() => nav.navigate('PaymentMethods')}
              />
            }
          />
        ) : (
          <View style={styles.methods}>
            {validated.map(m => (
              <PaymentMethodCard
                key={m.id}
                method={m}
                selected={m.id === method?.id}
                onPress={() => setMethodId(m.id)}
              />
            ))}
          </View>
        )}

        {method && hold !== null && (
          <Notice
            tone="info"
            icon="shield-check"
            title={`We’ll hold ${formatInr(hold)} on ${method.label} ${
              method.detail
            }`}
            body="That’s a pre-authorisation, not a charge. You only pay for the energy you use; the rest is released."
          />
        )}

        {formError && (
          <Notice
            tone={formError.kind === 'offline' ? 'warn' : 'danger'}
            title={formError.title}
            body={formError.body}
            action={
              formError.kind === 'payment' ? (
                <TextButton
                  label="Fix payment"
                  onPress={() => nav.navigate('PaymentMethods')}
                />
              ) : formError.kind === 'session' ? (
                <TextButton
                  label="Open my session"
                  onPress={() => resumeSession(nav)}
                />
              ) : undefined
            }
          />
        )}
      </View>
    </Screen>
  );
}

function Estimate({label, value}: {label: string; value: string}) {
  return (
    <View
      style={styles.estimate}
      accessible
      accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.estimateLabel}>{label}</Text>
      <Text style={styles.estimateValue}>{value}</Text>
    </View>
  );
}

/** Used when PlugOrbit does not control the charger. */
function OperatorHandoff({
  station,
  reason,
}: {
  station: StationWithDistance;
  reason: string | null;
}) {
  const nav = useNavigation();
  return (
    <View style={styles.pad}>
      <Notice
        tone="info"
        title={`${station.operator} runs this charger`}
        body={
          reason ??
          'PlugOrbit can’t start or bill this charger. Use the operator’s own app or QR code; we’ll help you get there.'
        }
      />
      <Card>
        <Text style={styles.stepsTitle}>How to start it</Text>
        <Text style={styles.stepsBody}>
          {station.operatorInstructions ??
            'Open the operator’s app, scan the QR on the charger and pay there.'}
        </Text>
        <View style={styles.steps}>
          <Step n={1} text="Park at the charger and plug in." />
          <Step n={2} text="Start and pay in the operator’s app." />
          <Step
            n={3}
            text="Keep their receipt; PlugOrbit support can help with it."
          />
        </View>
      </Card>
      <PrimaryButton
        label="Get directions"
        icon="navigation"
        onPress={async () => {
          const ok = await openDirections(station);
          if (!ok) {
            showToast('Couldn’t open Google Maps.', 'warn');
          }
        }}
      />
      <SecondaryButton
        label="Report a problem"
        icon="flag"
        onPress={() => nav.navigate('ReportProblem', {stationId: station.id})}
      />
      <View style={styles.center}>
        <TextButton label="Back to station" tone="muted" onPress={nav.goBack} />
      </View>
    </View>
  );
}

function Step({n, text}: {n: number; text: string}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepDot}>
        <Text style={styles.stepNum}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  pad: {gap: spacing.md},
  loading: {gap: spacing.md},
  scroll: {gap: spacing.md, paddingBottom: spacing.lg},
  muted: {...type.caption, color: colors.muted},
  heroLabel: {...type.micro, color: colors.lime, textTransform: 'uppercase'},
  heroTitle: {...type.display, color: '#FFFFFF', marginTop: 6},
  heroSub: {...type.body, color: colors.chipText, marginTop: 4},
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  noticeActions: {gap: 2, marginTop: 6, alignItems: 'flex-start'},
  priceAge: {paddingBottom: 2},
  targetHead: {flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm},
  targetValue: {...type.display, color: colors.ink, fontSize: 34},
  estimates: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm},
  estimate: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: radii.md,
    padding: spacing.md,
  },
  estimateLabel: {...type.caption, color: colors.muted, fontSize: 11.5},
  estimateValue: {...type.bodyStrong, color: colors.ink, marginTop: 2},
  fine: {...type.caption, color: colors.muted, marginTop: spacing.md},
  methods: {gap: spacing.sm},
  cta: {gap: spacing.sm},
  ctaHint: {...type.caption, color: colors.muted, textAlign: 'center'},
  stepsTitle: {...type.heading, color: colors.ink},
  stepsBody: {
    ...type.body,
    color: colors.inkSoft,
    marginTop: 6,
    lineHeight: 20,
  },
  steps: {gap: spacing.md, marginTop: spacing.lg},
  step: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: {...type.micro, color: colors.lime},
  stepText: {...type.body, color: colors.ink, flex: 1},
  center: {alignItems: 'center'},
});
