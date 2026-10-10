import React, {useCallback, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {QrCamera} from '../../components/QrCamera';
import {DEFAULT_CENTER} from '../../config/google';
import {chargerCode, resolveChargerCode} from '../../domain/chargerCode';
import {describeError} from '../../domain/describeError';
import {compatibleConnectors, connectorFits} from '../../domain/rules';
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

/** Scan a physical charger QR, or enter its printed ID manually. */
export default function ScanQrScreen(): React.JSX.Element {
  const nav = useNavigation();
  const active = useIsActiveRef();
  const {params} = useRoute<'ScanQr'>();
  const {station: stationService} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const focused = useIsFocused();
  const resolving = useRef(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [code, setCode] = useState('');
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
      setError(null);
      try {
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
        <SecondaryButton
          label="Enter charger ID manually"
          icon="pencil"
          onPress={() => setManualOpen(true)}
        />
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
            ? 'Looking up charger?'
            : 'Keep the QR code inside the frame. Scanning starts automatically.'}
        </Text>
        {error && (
          <Notice
            tone="danger"
            title="Couldn?t use that charger"
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
  return <View style={[styles.corner, style]} />;
}

const styles = StyleSheet.create({
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
