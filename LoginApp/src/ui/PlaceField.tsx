import {useAppearance, useThemedStyles} from '../appearance';
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, Pressable, View} from 'react-native';
import {useServices} from '../services';
import {colors, spacing} from '../theme';
import {AddressChoice, searchAddresses} from '../services/addressSearch';
import {hasGoogleApiKey} from '../config/google';
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
  onSelect,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  icon?: 'map-pin' | 'navigation' | 'flag';
  error?: string;
  onSelect?: (place: AddressChoice) => void;
}) {
  useAppearance();
  const styles=useThemedStyles(baseStyles);

  const {route} = useServices();
  const [addresses, setAddresses] = useState<AddressChoice[]>([]);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
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

  useEffect(() => {
    setAddresses([]); setSearchError(''); setSearching(false);
    if (!focused || !hasGoogleApiKey || value.trim().length < 3 || value === selectedLabel) return;
    const controller = new AbortController();
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchAddresses(value, controller.signal).then(list => {
        if (alive) setAddresses(list);
      }).catch(e => {
        if (alive) setSearchError(e.message || 'Could not search addresses.');
      }).finally(() => {if (alive) setSearching(false);});
    }, 450);
    return () => {alive = false; clearTimeout(timer); controller.abort();};
  }, [focused, onSelect, selectedLabel, value]);

  const exact = options.some(
    o => o.toLowerCase() === value.trim().toLowerCase(),
  );
  const show = focused && !exact && options.length > 0 && addresses.length === 0 && !searching;

  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? "Search address, landmark or location"}
        icon={icon}
        error={error}
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && searching && <Text style={styles.hint}>Searching addresses...</Text>}
      {focused && searchError !== '' && <Text style={styles.hint}>{searchError}</Text>}
      {focused && addresses.map(place => (
        <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={place.label}
          style={styles.address} onPress={() => {
            setSelectedLabel(place.label); setFocused(false); setAddresses([]);
            onChangeText(place.label); onSelect?.(place);
          }}>
          <Text style={styles.addressText}>{place.label}</Text>
        </Pressable>
      ))}
      {focused && addresses.length > 0 && <Text style={styles.hint}>Google Maps</Text>}
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

const baseStyles = StyleSheet.create({
  address: {padding: 12, borderRadius: 12, backgroundColor: colors.inputBg},
  addressText: {color: colors.ink, fontSize: 14},
  hint: {color: colors.muted, fontSize: 12},
  wrap: {gap: spacing.sm},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
});
