import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ConnectorType} from '../../domain/types';
import {
  CUSTOM_CONNECTORS,
  EMPTY_VEHICLE_FORM,
  VehicleFormErrors,
  VehicleFormInput,
  VehicleSpec,
  hasDcConnector,
  sameCar,
  validateVehicleForm,
  vehicleToForm,
} from '../../domain/vehicleForm';
import {ErrorCopy, describeError, errorTone} from '../../domain/describeError';
import {useNavigation, useRoute} from '../../navigation/NavigationContext';
import {useServices} from '../../services';
import type {VehicleModel} from '../../services/types';
import {useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {
  AsyncView,
  CONNECTOR_INFO,
  ConnectorSelectionCard,
  ConnectorTag,
  EmptyState,
  ListSkeleton,
  Notice,
  PrimaryButton,
  Screen,
  SearchField,
  SegmentedControl,
  TextButton,
  TextField,
  showToast,
  useResource,
} from '../../ui';
import {KeyboardSpacer} from '../../ui/KeyboardSpacer';
import {VehicleSpecCard} from '../../ui/VehicleSpecCard';

type Mode = 'pick' | 'custom';

const MODES = [
  {value: 'pick' as const, label: 'Choose model'},
  {value: 'custom' as const, label: 'My car isn’t listed'},
];

const carName = (c: {make: string; model: string}) => `${c.make} ${c.model}`;

function toSpec(m: VehicleModel): VehicleSpec {
  return {
    make: m.make,
    model: m.model,
    variant: m.variant,
    batteryKwh: m.batteryKwh,
    connectors: m.connectors,
    maxDcKw: m.maxDcKw,
    maxAcKw: m.maxAcKw,
    rangeKm100: m.rangeKm100,
  };
}

function matches(m: VehicleModel, q: string): boolean {
  const hay = `${m.make} ${m.model} ${m.variant}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(part => hay.includes(part));
}

/**
 * 01 Vehicle setup. Choose a model from the catalogue (searchable) or describe
 * a car that isn't listed. The connectors saved here drive the compatibility
 * filter everywhere, so the screen says so plainly.
 */
export default function VehicleSetupScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {params} = useRoute<'VehicleSetup'>();
  const {vehicle: vehicleService} = useServices();
  const onboarding = params?.onboarding === true;
  const editingId = params?.vehicleId;
  const existing = useApp(s =>
    editingId ? s.vehicles.find(v => v.id === editingId) ?? null : null,
  );
  const activeId = useApp(s => s.activeVehicleId);
  const editing = existing !== null;

  const catalog = useResource(() => vehicleService.catalog(), []);

  // Editing opens the editable form (works for catalogue and custom cars alike).
  const [mode, setMode] = useState<Mode>(editing ? 'custom' : 'pick');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleFormInput>(() =>
    existing ? vehicleToForm(existing) : EMPTY_VEHICLE_FORM,
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ErrorCopy | null>(null);

  const validation = useMemo(() => validateVehicleForm(form), [form]);
  const errors: VehicleFormErrors =
    submitted && !validation.ok ? validation.errors : {};
  const missing = editingId !== undefined && !editing;

  const setField = <K extends keyof VehicleFormInput>(
    key: K,
    value: VehicleFormInput[K],
  ) => {
    setForm(f => ({...f, [key]: value}));
    setSaveError(null);
  };

  const toggleConnector = (value: ConnectorType) =>
    setField(
      'connectors',
      form.connectors.includes(value)
        ? form.connectors.filter(c => c !== value)
        : [...form.connectors, value],
    );

  // Editing a catalogue car shows its card as already chosen.
  const currentId =
    selectedId ??
    (existing
      ? catalog.data?.find(m => sameCar(m, existing))?.modelId ?? null
      : null);
  const selectedModel =
    catalog.data?.find(m => m.modelId === currentId) ?? null;

  const startCustom = (prefill?: string) => {
    if (prefill && form.model === '' && form.make === '') {
      setForm(f => ({...f, model: prefill}));
    }
    setMode('custom');
  };

  const save = async () => {
    let spec: VehicleSpec;
    if (mode === 'pick') {
      if (!selectedModel) {
        return;
      }
      spec = toSpec(selectedModel);
    } else {
      setSubmitted(true);
      if (!validation.ok) {
        return;
      }
      spec = validation.vehicle;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await vehicleService.save(
        editing ? {...spec, id: editingId} : spec,
      );
      // `save` makes the car active; editing a spare car must not switch cars.
      if (editing && activeId && activeId !== saved.id) {
        await vehicleService.setActive(activeId);
      }
      showToast(
        editing
          ? `${carName(saved)} updated.`
          : `${carName(saved)} added. We’ll only show chargers that fit.`,
        'success',
      );
      if (onboarding) {
        nav.replace('ManualSoc', {onboarding: true});
      } else {
        nav.goBack();
      }
    } catch (e) {
      setSaveError(describeError(e, 'We couldn’t save your vehicle.'));
      setSaving(false);
    }
  };

  const canSave = mode === 'custom' || selectedModel !== null;
  const chosenConnectors =
    mode === 'pick' ? selectedModel?.connectors ?? [] : form.connectors;
  return (
    <Screen
      title={editing ? 'Edit vehicle' : 'Vehicle setup'}
      footer={
        <>
          {chosenConnectors.length > 2 ? (
            <Text style={styles.hint} numberOfLines={2}>
              {`Chargers with ${chosenConnectors
                .map(c => CONNECTOR_INFO[c].name)
                .join(', ')}`}
            </Text>
          ) : chosenConnectors.length > 0 ? (
            <View style={styles.footerPlugs}>
              <Text style={styles.hint}>Chargers with</Text>
              {chosenConnectors.map(c => (
                <ConnectorTag key={c} type={c} />
              ))}
            </View>
          ) : (
            <Text style={styles.hint}>
              {mode === 'pick'
                ? 'Choose your car to continue.'
                : 'Pick the plugs your car can use.'}
            </Text>
          )}
          <PrimaryButton
            label={editing ? 'Save changes' : 'Save vehicle'}
            icon="check"
            onPress={save}
            loading={saving}
            disabled={!canSave}
          />
        </>
      }>
      <Text style={styles.heading} accessibilityRole="header">
        {editing ? 'Edit your EV' : 'Add your EV'}
      </Text>
      <Text style={styles.lead}>
        {onboarding
          ? 'Step 1 of 2. Tell us what you drive.'
          : 'Pick your model so we can match chargers.'}
      </Text>

      <View style={styles.block}>
        <Notice
          tone="lime"
          icon="plug-zap"
          title="We’ll only show chargers that fit"
          body="Plugs your car can’t use stay hidden, so you never drive to the wrong one."
        />
      </View>

      {missing && (
        <View style={styles.block}>
          <Notice
            tone="warn"
            title="That vehicle is no longer saved"
            body="It may have been removed. You can add it again below."
          />
        </View>
      )}

      <View style={styles.block}>
        <SegmentedControl options={MODES} value={mode} onChange={setMode} />
      </View>

      {saveError && (
        <View style={styles.block}>
          <Notice
            tone={errorTone(saveError)}
            title={saveError.title}
            body={saveError.body}
          />
        </View>
      )}

      {mode === 'pick' ? (
        <View style={styles.block}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search make or model"
          />
          <View style={styles.list}>
            <AsyncView
              resource={catalog}
              loading={<ListSkeleton count={4} />}
              errorTitle="Couldn’t load car models"
              errorBody="Check your connection and try again, or choose “My car isn’t listed” and enter your car yourself."
              isEmpty={data => !data.some(m => matches(m, query))}
              empty={
                <EmptyState
                  icon="search"
                  title="No match"
                  body={`We couldn’t find “${query.trim()}”. Try another make or model, or enter your car yourself.`}
                  primary={{
                    label: 'My car isn’t listed',
                    icon: 'plus',
                    onPress: () => startCustom(query.trim()),
                  }}
                  secondary={{
                    label: 'Clear search',
                    onPress: () => setQuery(''),
                  }}
                />
              }
              render={data => (
                <>
                  {data
                    .filter(m => matches(m, query))
                    .map(m => (
                      <VehicleSpecCard
                        key={m.modelId}
                        spec={m}
                        selected={m.modelId === currentId}
                        onPress={() => {
                          setSelectedId(m.modelId);
                          setSaveError(null);
                        }}
                      />
                    ))}
                  <TextButton
                    label="My car isn’t listed"
                    icon="plus"
                    onPress={() => startCustom()}
                  />
                </>
              )}
            />
          </View>
        </View>
      ) : (
        <View style={[styles.block, styles.form]}>
          <TextField
            label="Make"
            value={form.make}
            onChangeText={t => setField('make', t)}
            placeholder="e.g. Tata"
            autoCapitalize="words"
            autoCorrect={false}
            error={errors.make}
          />
          <TextField
            label="Model"
            value={form.model}
            onChangeText={t => setField('model', t)}
            placeholder="e.g. Nexon EV"
            autoCapitalize="words"
            autoCorrect={false}
            error={errors.model}
          />
          <TextField
            label="Variant (optional)"
            value={form.variant}
            onChangeText={t => setField('variant', t)}
            placeholder="e.g. Long Range"
            autoCapitalize="words"
            autoCorrect={false}
            error={errors.variant}
          />
          <TextField
            label="Battery size (kWh)"
            value={form.batteryKwh}
            onChangeText={t => setField('batteryKwh', t)}
            placeholder="e.g. 40.5"
            keyboardType="decimal-pad"
            icon="battery-charging"
            error={errors.batteryKwh}
            helper="Usable pack size, from your brochure or the car’s info screen."
          />

          <View style={styles.group}>
            <Text style={styles.groupLabel}>Which plug does your car use?</Text>
            <View style={styles.connectorGrid}>
              {CUSTOM_CONNECTORS.map(c => (
                <ConnectorSelectionCard
                  key={c.value}
                  type={c.value}
                  selected={form.connectors.includes(c.value)}
                  onPress={() => toggleConnector(c.value)}
                />
              ))}
            </View>
            {errors.connectors ? (
              <Text style={styles.error}>{errors.connectors}</Text>
            ) : (
              <Text style={styles.helper}>
                Tap every plug your car can use. Most CCS2 cars also charge on
                Type 2 AC.
              </Text>
            )}
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>Charging limits (optional)</Text>
            <View style={styles.pair}>
              <View style={styles.half}>
                <TextField
                  label="Fast charge (kW)"
                  value={form.maxDcKw}
                  onChangeText={t => setField('maxDcKw', t)}
                  placeholder={hasDcConnector(form.connectors) ? '50' : 'None'}
                  keyboardType="decimal-pad"
                  editable={hasDcConnector(form.connectors)}
                  error={errors.maxDcKw}
                />
              </View>
              <View style={styles.half}>
                <TextField
                  label="AC charge (kW)"
                  value={form.maxAcKw}
                  onChangeText={t => setField('maxAcKw', t)}
                  placeholder={
                    form.connectors.includes('Type2') ? '7.2' : 'None'
                  }
                  keyboardType="decimal-pad"
                  editable={form.connectors.includes('Type2')}
                  error={errors.maxAcKw}
                />
              </View>
            </View>
            <TextField
              label="Real-world range at 100% (km)"
              value={form.rangeKm}
              onChangeText={t => setField('rangeKm', t)}
              placeholder="Estimated from your battery"
              keyboardType="number-pad"
              error={errors.rangeKm}
              helper="Only used for estimates, never as a guarantee."
            />
          </View>
          <KeyboardSpacer />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {...type.display, color: colors.ink},
  lead: {...type.body, color: colors.muted, marginTop: spacing.xs},
  block: {marginTop: spacing.lg},
  list: {gap: spacing.md, marginTop: spacing.md},
  form: {gap: spacing.lg},
  group: {gap: spacing.md},
  groupLabel: {...type.label, color: colors.ink},
  connectorGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  pair: {flexDirection: 'row', gap: spacing.md},
  half: {flex: 1},
  helper: {...type.caption, color: colors.muted},
  error: {...type.caption, color: colors.danger, fontWeight: '700'},
  hint: {...type.caption, color: colors.muted, textAlign: 'center'},
  footerPlugs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
