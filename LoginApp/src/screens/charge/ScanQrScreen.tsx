import {useAppearance, useThemedStyles} from '../../appearance';
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Linking, NativeModules, StyleSheet, Text, View} from 'react-native';
import {QrCamera} from '../../components/QrCamera';
import {DEFAULT_CENTER} from '../../config/google';
import {chargerCode, resolveChargerCode} from '../../domain/chargerCode';
import {describeError} from '../../domain/describeError';
import {
  availableCount,
  compatibleConnectors,
  connectorFits,
  rankOrganic,
} from '../../domain/rules';
import type {Station, StationWithDistance} from '../../domain/types';
import {
  useIsActiveRef,
  useIsFocused,
  useNavigation,
  useRoute,
} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import {getCurrentLocation} from '../../services/location';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import type {Coords} from '../../utils/geo';
import {colors, radii, spacing, type} from '../../theme';
import {
  BottomSheet,
  Notice,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextField,
} from '../../ui';

const BRACKET = 34;

/**
 * Scan a physical charger QR with the live in-app camera (or Google's scanner), or enter
 * its printed ID manually. Registered charger IDs are verified before use; an operator
 * website QR is only ever opened after an explicit tap.
 */
export default function ScanQrScreen(): React.JSX.Element {
  const styles=useThemedStyles(baseStyles);

  const nav = useNavigation();
  const active = useIsActiveRef();
  const focused = useIsFocused();
  const {params} = useRoute<'ScanQr'>();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const resolving = useRef(false);
  const hasGoogleScanner = !!NativeModules.PlugOrbitDeviceTools?.scanQr;

  const [manualOpen, setManualOpen] = useState(false);
  const [code, setCode] = useState('');
  const [operatorLink, setOperatorLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async (): Promise<StationWithDistance[]> => {
    let origin: Coords = DEFAULT_CENTER;
    try {
      origin = await getCurrentLocation();
    } catch {
      // Fine: the station list does not depend on where the phone is.
    }
    return stationService.nearby({origin, vehicle, includeIncompatible: true});
  }, [stationService, vehicle]);

  const go = useCallback(
    (station: Station, connectorId: string) => {
      // The lookup is async: if the user already left, do not pull them back.
      if (active.current) {
        nav.replace('StartCharging', {stationId: station.id, connectorId});
      }
    },
    [nav, active],
  );

  /** Turn a code into a charger, with a clear reason when it can't be used. */
  const handleCode = useCallback(
    async (raw: string) => {
      if (resolving.current || !active.current) {
        return;
      }
      resolving.current = true;
      setBusy(true);
      setError(null); setOperatorLink('');
      try {
        if (raw.trim().length > 2048) throw new Error('This QR code is too long. Enter the charger ID manually.');
        if (/^https:\/\//i.test(raw.trim())) {
          const url = new URL(raw.trim());
          if (url.username || url.password) throw new Error('This QR link could not be opened safely.');
          setOperatorLink(url.toString()); return;
        }
        const all = await loadAll();
        const hit = resolveChargerCode(raw, all);
        if (!hit) {
          setError(
            'We couldn’t find that charger. Check the code printed under the QR and try again.',
          );
          return;
        }
        if (!connectorFits(hit.connector, vehicle)) {
          const fitting = compatibleConnectors(hit.station, vehicle)
            .map(c => c.label)
            .join(', ');
          setError(
            `${hit.connector.label} is a ${
              hit.connector.type
            } connector, which your ${
              vehicle ? `${vehicle.make} ${vehicle.model}` : 'car'
            } can’t use.${fitting ? ` Try ${fitting} at this station.` : ''}`,
          );
          return;
        }
        setManualOpen(false);
        go(hit.station, hit.connector.id);
      } catch (e) {
        setError(describeError(e, 'We couldn’t look up that charger.').body);
      } finally {
        resolving.current = false;
        setBusy(false);
      }
    },
    [active, go, loadAll, vehicle],
  );

  /** Google's own scanner: needs no camera permission, so it also works when that is denied. */
  const scanWithGoogle = useCallback(async () => {
    if (busy || !active.current) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const raw = await NativeModules.PlugOrbitDeviceTools.scanQr();
      if (typeof raw === 'string' && raw.trim() && active.current) {
        // handleCode takes over the busy state.
        setBusy(false);
        await handleCode(raw);
      }
    } catch (e) {
      if (active.current) {
        setError(
          e instanceof Error ? e.message : 'Could not open the camera scanner.',
        );
      }
    } finally {
      if (active.current) {
        setBusy(false);
      }
    }
  }, [active, busy, handleCode]);

  /** Development only: pick a charger without a camera (emulators have none). */
  const simulate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const all = await loadAll();
      const preferred = params?.stationId
        ? all.find(s => s.id === params.stationId)
        : undefined;
      const pool = preferred
        ? [preferred]
        : rankOrganic(
            all.filter(s => s.integration === 'integrated'),
            vehicle,
          );
      const station =
        pool.find(s => availableCount(s, vehicle) > 0) ?? pool[0] ?? null;
      if (!station) {
        setError('No compatible charger was found to scan.');
        return;
      }
      const connector =
        compatibleConnectors(station, vehicle).find(
          c => c.status === 'available',
        ) ??
        compatibleConnectors(station, vehicle)[0] ??
        station.connectors[0];
      go(station, connector.id);
    } catch (e) {
      setError(describeError(e, 'We couldn’t read that code.').body);
    } finally {
      setBusy(false);
    }
  }, [go, loadAll, params?.stationId, vehicle]);

  const example = useMemo(
    () =>
      chargerCode(
        {id: params?.stationId ?? 'st-chargezone-neemrana'},
        {label: 'C2'},
      ),
    [params?.stationId],
  );

  return (
    <Screen
      title="Scan charger QR"
      footer={
        <>
          {hasGoogleScanner && (
            <SecondaryButton
              label="Use Google scanner"
              icon="scan-line"
              disabled={busy}
              onPress={scanWithGoogle}
              accessibilityHint="Opens Google's QR scanner, which needs no camera permission"
            />
          )}
          {__DEV__ && (
            <SecondaryButton label="Simulate scan" onPress={simulate} />
          )}
          <SecondaryButton
            label="Enter charger ID manually"
            icon="pencil"
            onPress={() => setManualOpen(true)}
          />
        </>
      }>
      <View style={styles.stage}>
        <View style={styles.finder} accessibilityLabel="Camera viewfinder">
          <QrCamera
            active={focused && !manualOpen && !busy && !error}
            onDecoded={handleCode}
          />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Corner style={styles.tl} />
            <Corner style={styles.tr} />
            <Corner style={styles.bl} />
            <Corner style={styles.br} />
          </View>
        </View>
        <Text style={styles.hint}>Point the camera at the charger QR code</Text>
        <Text style={styles.sub}>
          {busy
            ? 'Looking up charger…'
            : 'Keep the QR code inside the frame. Scanning starts automatically.'}
        </Text>
        {!!operatorLink && (
          <Notice
            tone="info"
            title="QR website link"
            body={`This QR opens ${new URL(operatorLink).hostname}. Verify this is your charging operator. PlugOrbit will not start charging or make a payment automatically.`}
            action={
              <SecondaryButton
                label="Open QR website"
                icon="link"
                onPress={async () => {
                  try {
                    await Linking.openURL(operatorLink);
                  } catch {
                    setError('Could not open the operator website.');
                  }
                }}
              />
            }
          />
        )}
        {error && (
          <Notice
            tone="danger"
            title="Couldn’t use that charger"
            body={error}
          />
        )}
        {error && (
          <SecondaryButton
            label="Scan again"
            icon="refresh-cw"
            onPress={() => setError(null)}
          />
        )}
      </View>

      <BottomSheet
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Enter charger ID"
        footer={
          <PrimaryButton
            label="Find charger"
            icon="search"
            loading={busy}
            disabled={code.trim().length === 0}
            onPress={() => handleCode(code)}
          />
        }>
        <TextField
          label="Charger ID"
          value={code}
          onChangeText={t => {
            setCode(t);
            setError(null);
          }}
          placeholder={example}
          autoCapitalize="characters"
          autoCorrect={false}
          icon="hash"
          helper={`It’s printed under the QR, like ${example}.`}
          error={manualOpen ? error ?? undefined : undefined}
          onSubmitEditing={() => handleCode(code)}
          returnKeyType="go"
        />
      </BottomSheet>
    </Screen>
  );
}

function Corner({style}: {style: object}) {
  useAppearance();
  const styles=useThemedStyles(baseStyles);

  return <View style={[styles.corner, style]} />;
}

const baseStyles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  finder: {
    width: '100%',
    maxWidth: 340,
    aspectRatio: 1,
    borderRadius: radii.lg,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
    borderColor: colors.lime,
  },
  tl: {
    top: 16,
    left: 16,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  tr: {
    top: 16,
    right: 16,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  bl: {
    bottom: 16,
    left: 16,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  br: {
    bottom: 16,
    right: 16,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  hint: {...type.bodyStrong, color: colors.ink, textAlign: 'center'},
  sub: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
});
