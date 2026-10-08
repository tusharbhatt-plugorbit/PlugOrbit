import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {TabName} from '../navigation/params';
import {colors, sizes, type} from '../theme';
import {Icon, IconName} from './Icon';

const TAB_META: Record<TabName, {label: string; icon: IconName}> = {
  Home: {label: 'Home', icon: 'house'},
  Trips: {label: 'Trips', icon: 'route'},
  Charge: {label: 'Charge', icon: 'zap'},
  Activity: {label: 'Activity', icon: 'history'},
  Profile: {label: 'Profile', icon: 'user'},
};

const ORDER: TabName[] = ['Home', 'Trips', 'Charge', 'Activity', 'Profile'];

/**
 * Bottom navigation in the dark shell colour with lime for the active tab.
 * "Charge" is the primary action, so it gets the lime bolt button.
 */
export function TabBar({
  tab,
  onSelect,
  badges = {},
}: {
  tab: TabName;
  onSelect: (t: TabName) => void;
  badges?: Partial<Record<TabName, boolean>>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bar, {paddingBottom: Math.max(insets.bottom, 8)}]}
      accessibilityRole="tablist">
      {ORDER.map(t => {
        const meta = TAB_META[t];
        const active = t === tab;
        const center = t === 'Charge';
        return (
          <Pressable
            key={t}
            onPress={() => onSelect(t)}
            accessibilityRole="tab"
            accessibilityLabel={meta.label}
            accessibilityState={{selected: active}}
            testID={`tab-${t}`}
            style={styles.item}>
            {center ? (
              <View style={[styles.fab, active && styles.fabActive]}>
                <Icon name="zap" size={22} color={colors.ink} filled />
              </View>
            ) : (
              <View>
                <Icon
                  name={meta.icon}
                  size={22}
                  color={active ? colors.lime : colors.placeholder}
                  strokeWidth={active ? 2.4 : 2}
                />
                {badges[t] && <View style={styles.badge} />}
              </View>
            )}
            <Text style={[styles.label, active && styles.labelActive]}>
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingTop: 8,
    minHeight: sizes.tabBar,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minHeight: 48,
  },
  label: {
    ...type.caption,
    fontSize: 11,
    fontWeight: '600',
    color: colors.placeholder,
  },
  labelActive: {color: colors.lime, fontWeight: '800'},
  fab: {
    width: 46,
    height: 46,
    borderRadius: 16,
    marginTop: -22,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.bg,
  },
  fabActive: {backgroundColor: '#B9F78A'},
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.lime,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
});
