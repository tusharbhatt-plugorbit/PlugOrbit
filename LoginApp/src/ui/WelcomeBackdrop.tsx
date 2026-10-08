import React from 'react';
import {StyleSheet} from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

// The scene is drawn in a 400x800 box and anchored to the bottom ("slice"), so
// the road always reaches the bottom edge and the sky absorbs any extra height.
const HORIZON = 520;
const BOTTOM = 800;
const DASH_COUNT = 6;
// The nearest dashes would run under the buttons, so only the far ones draw.
const DASHES_SHOWN = 4;

/** Dashes of the road's centre line, shrinking toward the horizon. */
const DASHES = Array.from({length: DASHES_SHOWN}, (_, i) => {
  const near = Math.pow(i / DASH_COUNT, 1.8);
  const far = Math.pow((i + 0.5) / DASH_COUNT, 1.8);
  const yNear = HORIZON + (BOTTOM - HORIZON) * near;
  const yFar = HORIZON + (BOTTOM - HORIZON) * far;
  const wNear = 0.8 + 5 * near;
  const wFar = 0.8 + 5 * far;
  return `M${200 - wNear} ${yNear} L${200 + wNear} ${yNear} L${
    200 + wFar
  } ${yFar} L${200 - wFar} ${yFar} Z`;
}).join(' ');

/**
 * Decorative night-road scene for the first screen: a lime-lit horizon, a
 * road with a dashed centre line and a charger by the roadside. Purely vector
 * (no download, sharp on every phone) and faded to near-black at the bottom so
 * the buttons on top stay readable.
 */
export function WelcomeBackdrop({
  showRoad = true,
  showCharger = true,
}: {
  /** Off on very short phones, where the horizon would cut through the copy. */
  showRoad?: boolean;
  /** Off on short phones, where the roadside charger would sit under the copy. */
  showCharger?: boolean;
}) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      viewBox="0 0 400 800"
      preserveAspectRatio="xMidYMax slice"
      pointerEvents="none">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0C1830" />
          <Stop offset="0.65" stopColor="#09111F" />
          <Stop offset="1" stopColor="#060A12" />
        </LinearGradient>
        <RadialGradient
          id="glow"
          cx="200"
          cy="520"
          rx="240"
          ry="110"
          gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#A2F067" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#A2F067" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="road" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1A2943" />
          <Stop offset="1" stopColor="#0A101C" />
        </LinearGradient>
        <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#060A12" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#060A12" stopOpacity="0.7" />
          <Stop offset="1" stopColor="#060A12" stopOpacity="0.97" />
        </LinearGradient>
      </Defs>

      <Rect x="-200" y="0" width="800" height="800" fill="url(#sky)" />
      <Rect x="-200" y="0" width="800" height="800" fill="url(#glow)" />

      {showRoad && (
        <>
          {/* Road in perspective, with its edge lines and centre dashes. */}
          <Path
            d={`M188 ${HORIZON} L212 ${HORIZON} L520 ${BOTTOM} L-120 ${BOTTOM} Z`}
            fill="url(#road)"
          />
          <Path
            d={`M188 ${HORIZON} L-120 ${BOTTOM} M212 ${HORIZON} L520 ${BOTTOM}`}
            stroke="#A2F067"
            strokeOpacity="0.28"
            strokeWidth="1.5"
          />
          <Path d={DASHES} fill="#A2F067" fillOpacity="0.7" />
          <Rect
            x="-200"
            y={HORIZON}
            width="800"
            height="1"
            fill="#A2F067"
            fillOpacity="0.3"
          />
        </>
      )}

      {showRoad && showCharger && (
        <>
          {/* A charger beside the road. */}
          <Rect
            x="268"
            y="514"
            width="64"
            height="6"
            rx="3"
            fill="#A2F067"
            fillOpacity="0.18"
          />
          <Rect
            x="291"
            y="456"
            width="18"
            height="64"
            rx="5"
            fill="#1B2A44"
            stroke="#A2F067"
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <Rect x="295" y="462" width="10" height="18" rx="2" fill="#0B1220" />
          <Path
            d="M301.5 464 L297.5 472 H301 L299.5 478 L304.5 469.5 H301 Z"
            fill="#A2F067"
          />
          <Path
            d="M309 492 C 322 494 324 506 322 514"
            fill="none"
            stroke="#3A4E72"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}

      <Rect x="-200" y="470" width="800" height="330" fill="url(#fade)" />
    </Svg>
  );
}
