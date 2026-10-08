import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '../navigation/NavigationContext';
import {selectActiveVehicle, useApp} from '../store/appStore';
import {colors, radii, slopFor, spacing, type} from '../theme';
import {useServices} from '../services';
import {BottomSheet} from './BottomSheet';
import {PrimaryButton, SecondaryButton} from './Buttons';
import {Icon} from './Icon';
import {vehicleName} from './session';

/** Compact "Nexon EV • 60%" pill. On dark headers pass tone="dark". */
export function VehicleSelector({tone = 'dark'}: {tone?: 'dark' | 'light'}) {
  const nav = useNavigation();
  const {vehicle: service} = useServices();
  const vehicle = useApp(selectActiveVehicle);
  const vehicles = useApp(s => s.vehicles);
  const battery = useApp(s => s.battery);
  const [open, setOpen] = useState(false);

  const dark = tone === 'dark';
  const fg = dark ? '#FFFFFF' : colors.ink;
  const label = vehicle ? vehicleName(vehicle) : 'Add your EV';

  return (
    <>
      <Pressable
        onPress={() => (vehicle ? setOpen(true) : nav.navigate('VehicleSetup'))}
        hitSlop={slopFor(40)}
        accessibilityRole="button"
        accessibilityLabel={
          vehicle
            ? `Vehicle ${label}, battery ${
                battery?.percent ?? 'unknown'
              } percent. Change vehicle`
            : 'Add your EV'
        }
        testID="vehicle-selector"
        style={[styles.pill, dark ? styles.pillDark : styles.pillLight]}>
        <Icon name="car" size={16} color={dark ? colors.lime : colors.ink} />
        <Text style={[styles.text, {color: fg}]} numberOfLines={1}>
          {label}
        </Text>
        {vehicle && battery && (
          <View style={styles.battery}>
            <Icon name="battery-charging" size={14} color={colors.ink} />
            <Text style={styles.batteryText}>{battery.percent}%</Text>
          </View>
        )}
        <Icon
          name="chevron-down"
          size={14}
          color={dark ? colors.placeholder : colors.muted}
        />
      </Pressable>
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Your vehicle"
        footer={
          <>
            <PrimaryButton
              label="Update battery"
              icon="battery-charging"
              onPress={() => {
                setOpen(false);
                nav.navigate('ManualSoc');
              }}
            />
            <SecondaryButton
              label="Add another vehicle"
              icon="plus"
              onPress={() => {
                setOpen(false);
                nav.navigate('VehicleSetup');
              }}
            />
          </>
        }>
        {vehicles.map(v => {
          const active = v.id === vehicle?.id;
          return (
            <Pressable
              key={v.id}
              onPress={async () => {
                await service.setActive(v.id);
                setOpen(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{selected: active}}
              style={[styles.option, active && styles.optionActive]}>
              <View style={styles.optionIcon}>
                <Icon name="car" size={20} color={colors.ink} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.optionTitle}>{vehicleName(v)}</Text>
                <Text style={styles.optionSub}>
                  {v.batteryKwh} kWh • {v.connectors.join(' / ')}
                </Text>
              </View>
              {active && (
                <Icon name="circle-check" size={22} color={colors.limeDark} />
              )}
            </Pressable>
          );
        })}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    maxWidth: '100%',
  },
  pillDark: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  pillLight: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  text: {...type.label, flexShrink: 1},
  battery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.lime,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    height: 24,
  },
  batteryText: {...type.micro, color: colors.ink},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
  },
  optionActive: {borderColor: colors.bg, backgroundColor: colors.limeSoft},
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {...type.bodyStrong, color: colors.ink},
  optionSub: {...type.caption, color: colors.muted, marginTop: 2},
});
