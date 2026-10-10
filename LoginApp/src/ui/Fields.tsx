import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  AccessibilityActionEvent,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import {
  colors,
  elevation,
  radii,
  sizes,
  slopFor,
  spacing,
  type,
} from '../theme';
import {Icon, IconName} from './Icon';
import {notifyInputFocused, useScrollOwner} from './KeyboardAware';

/** Light-surface text input in the Login field style (52px, 12px radius, 1.5px border). */
export function TextField({
  label,
  helper,
  error,
  icon,
  multiline,
  ...rest
}: TextInputProps & {
  label?: string;
  helper?: string;
  error?: string;
  icon?: IconName;
}) {
  const [focused, setFocused] = useState(false);
  const scrollOwner = useScrollOwner();
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.field,
          multiline && styles.fieldMulti,
          focused && styles.fieldFocused,
          !!error && styles.fieldError,
        ]}>
        {icon && <Icon name={icon} size={18} color={colors.muted} />}
        <TextInput
          {...rest}
          multiline={multiline}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          placeholderTextColor={colors.placeholderOnLight}
          // Large system text must not make the box jump while typing.
          maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? 1.3}
          underlineColorAndroid="transparent"
          onFocus={e => {
            setFocused(true);
            rest.onFocus?.(e);
            // With the keyboard already open, moving to this field fires no
            // keyboard event, so ask the enclosing scroll view to bring it in.
            notifyInputFocused(scrollOwner);
          }}
          onBlur={e => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            styles.input,
            multiline ? styles.inputMulti : styles.inputSingle,
            rest.style,
          ]}
        />
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

/** White search field as on Home. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  autoFocus,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <View style={[styles.search, elevation(1)]}>
      <Icon name="search" size={18} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholderOnLight}
        style={styles.searchInput}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        autoCorrect={false}
        autoFocus={autoFocus}
        clearButtonMode="while-editing"
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

/** A labelled on/off row ("Started", "Precise location"). */
export function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  last,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  last?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, !last && styles.divider]}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleTitle}>{title}</Text>
        {subtitle ? <Text style={styles.toggleSub}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{false: '#CBD5E1', true: colors.lime}}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#CBD5E1"
        accessibilityLabel={title}
      />
    </View>
  );
}

/** Selected = dark pill (same family as Home's lime-on-dark chips, inverted for light bodies). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{value: T; label: string}>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map(o => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            hitSlop={slopFor(38)}
            style={[styles.segmentItem, active && styles.segmentActive]}>
            <Text
              style={[styles.segmentText, active && styles.segmentTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Selectable chip (filters, quick values). */
export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{selected: !!selected}}
      hitSlop={slopFor(sizes.chip)}
      style={({pressed}) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && {opacity: 0.85},
      ]}>
      {icon && (
        <Icon
          name={icon}
          size={14}
          color={selected ? colors.ink : colors.inkSoft}
        />
      )}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Percentage slider with drag, tap, +/- steps and screen-reader adjust actions
 * (no native dependency).
 */
export function PercentSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}) {
  const width = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const setFromX = useCallback(
    (x: number) => {
      if (width.current <= 0) {
        return;
      }
      const ratio = Math.min(1, Math.max(0, x / width.current));
      const raw = min + ratio * (max - min);
      const stepped = Math.round(raw / step) * step;
      onChange(Math.min(max, Math.max(min, stepped)));
    },
    [max, min, onChange, step],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => setFromX(e.nativeEvent.locationX),
        onPanResponderMove: e => setFromX(e.nativeEvent.locationX),
      }),
    [setFromX],
  );

  const ratio = (value - min) / (max - min);
  const onAction = (e: AccessibilityActionEvent) => {
    const delta = e.nativeEvent.actionName === 'increment' ? step : -step;
    onChange(Math.min(max, Math.max(min, valueRef.current + delta)));
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{min, max, now: value, text: `${value} percent`}}
      accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
      onAccessibilityAction={onAction}>
      <View
        style={styles.sliderHit}
        onLayout={(e: LayoutChangeEvent) => {
          width.current = e.nativeEvent.layout.width;
        }}
        {...responder.panHandlers}>
        <View style={styles.sliderTrack} pointerEvents="none">
          <View style={[styles.sliderFill, {width: `${ratio * 100}%`}]} />
        </View>
        <View
          style={[styles.sliderThumb, elevation(2), {left: `${ratio * 100}%`}]}
          pointerEvents="none"
        />
      </View>
    </View>
  );
}

/** −  value  + stepper for small integer settings. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  label: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - step))}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        style={styles.stepBtn}>
        <Icon name="minus" size={18} color={colors.ink} />
      </Pressable>
      <Text
        style={styles.stepValue}
        accessibilityLabel={`${label} ${format ? format(value) : value}`}>
        {format ? format(value) : value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + step))}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={styles.stepBtn}>
        <Icon name="plus" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: {gap: 6},
  label: {...type.label, color: colors.ink},
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: sizes.field,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: 12,
  },
  fieldMulti: {minHeight: 120, alignItems: 'flex-start', paddingTop: 12},
  fieldFocused: {borderColor: colors.limeDark},
  fieldError: {borderColor: colors.danger},
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 0,
  },
  // Android pads text for font ascent/descent by default, which sits it low in
  // the box and makes it look misaligned next to the icon; centre it explicitly.
  inputSingle: {includeFontPadding: false, textAlignVertical: 'center'},
  inputMulti: {
    minHeight: 94,
    includeFontPadding: false,
    textAlignVertical: 'top',
  },
  helper: {...type.caption, color: colors.muted},
  error: {...type.caption, color: colors.danger, fontWeight: '700'},
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: sizes.field,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.ink,
    paddingVertical: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    minHeight: 60,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  toggleText: {flex: 1},
  toggleTitle: {...type.bodyStrong, color: colors.ink},
  toggleSub: {...type.caption, color: colors.muted, marginTop: 2},
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.slateSoft,
    borderRadius: radii.md,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    borderRadius: radii.md - 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  segmentActive: {backgroundColor: colors.bg},
  segmentText: {
    textAlign: 'center',
    flexShrink: 1,
    ...type.label,
    color: colors.inkSoft,
  },
  segmentTextActive: {color: '#FFFFFF'},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    minHeight: sizes.chip,
    paddingVertical: 8,
    maxWidth: '100%',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  chipSelected: {backgroundColor: colors.lime, borderColor: colors.lime},
  chipText: {
    flexShrink: 1,
    ...type.label,
    color: colors.inkSoft,
    fontWeight: '600',
  },
  chipTextSelected: {color: colors.ink, fontWeight: '800'},
  sliderHit: {height: 44, justifyContent: 'center'},
  sliderTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.slateSoft,
    overflow: 'hidden',
  },
  sliderFill: {height: '100%', backgroundColor: colors.lime},
  sliderThumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.bg,
    top: 8,
  },
  stepper: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  stepBtn: {
    width: sizes.tap,
    height: sizes.tap,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    ...type.h1,
    color: colors.ink,
    minWidth: 64,
    textAlign: 'center',
  },
});
