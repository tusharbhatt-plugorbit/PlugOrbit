import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

type IconProps = {size?: number; color: string};

// Small View-drawn glyphs: crisp at any density and identical on iOS/Android,
// unlike emoji, and they need no SVG dependency.

function SearchIconBase({size = 18, color}: IconProps) {
  const ring = size * 0.72;
  const stroke = Math.max(2, size * 0.12);
  return (
    <View style={{width: size, height: size}}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: stroke,
          borderColor: color,
        }}
      />
      <View
        style={[
          styles.abs,
          {
            width: stroke,
            height: size * 0.36,
            borderRadius: stroke / 2,
            backgroundColor: color,
            right: size * 0.1,
            bottom: -size * 0.02,
            transform: [{rotate: '-45deg'}],
          },
        ]}
      />
    </View>
  );
}

function CloseIconBase({size = 14, color}: IconProps) {
  const stroke = Math.max(2, size * 0.14);
  const bar = [
    styles.abs,
    {
      width: size,
      height: stroke,
      borderRadius: stroke / 2,
      backgroundColor: color,
      top: (size - stroke) / 2,
    },
  ];
  return (
    <View style={{width: size, height: size}}>
      <View style={[bar, {transform: [{rotate: '45deg'}]}]} />
      <View style={[bar, {transform: [{rotate: '-45deg'}]}]} />
    </View>
  );
}

function BackIconBase({size = 20, color}: IconProps) {
  const stroke = Math.max(2, size * 0.12);
  const head = size * 0.5;
  return (
    <View style={[styles.centerY, {width: size, height: size}]}>
      <View
        style={{
          width: size,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={[
          styles.abs,
          {
            width: head,
            height: head,
            left: size * 0.04,
            top: (size - head) / 2,
            borderLeftWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            borderBottomLeftRadius: stroke / 2,
            transform: [{rotate: '45deg'}],
          },
        ]}
      />
    </View>
  );
}

// Paper-plane style "navigate" arrow.
function NavigateIconBase({size = 16, color}: IconProps) {
  return (
    <View
      style={[
        styles.triangle,
        {
          borderLeftWidth: size * 0.4,
          borderRightWidth: size * 0.4,
          borderBottomWidth: size,
          borderBottomColor: color,
        },
      ]}
    />
  );
}

function BoltGlyphBase({size = 14, color}: IconProps) {
  // U+FE0E asks for the monochrome text glyph so `color` is respected.
  return (
    <Text
      allowFontScaling={false}
      style={[styles.glyph, {fontSize: size, lineHeight: size * 1.2, color}]}>
      {'⚡︎'}
    </Text>
  );
}

export const SearchIcon = React.memo(SearchIconBase);
export const CloseIcon = React.memo(CloseIconBase);
export const BackIcon = React.memo(BackIconBase);
export const NavigateIcon = React.memo(NavigateIconBase);
export const BoltGlyph = React.memo(BoltGlyphBase);

const styles = StyleSheet.create({
  abs: {position: 'absolute'},
  centerY: {justifyContent: 'center'},
  triangle: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    transform: [{rotate: '45deg'}],
  },
  glyph: {includeFontPadding: false},
});
