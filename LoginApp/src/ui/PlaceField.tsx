import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useServices} from '../services';
import {spacing} from '../theme';
import {Chip, TextField} from './Fields';

/**
 * A text field for a city with tappable suggestions from the route service.
 * Suggestions disappear once the text is an exact match.
 */
export function PlaceField({
  label,
  value,
  onChangeText,
  placeholder,
  icon = 'map-pin',
  error,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  icon?: 'map-pin' | 'navigation' | 'flag';
  error?: string;
}) {
  const {route} = useServices();
  const [focused, setFocused] = useState(false);
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    route
      .suggestions(value)
      .then(list => alive && setOptions(list))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [route, value]);

  const exact = options.some(
    o => o.toLowerCase() === value.trim().toLowerCase(),
  );
  const show = focused && !exact && options.length > 0;

  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        icon={icon}
        error={error}
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {show && (
        <View style={styles.chips}>
          {options.slice(0, 6).map(o => (
            <Chip key={o} label={o} onPress={() => onChangeText(o)} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: spacing.sm},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
});
