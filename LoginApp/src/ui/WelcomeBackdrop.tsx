import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, {
  Circle,
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
const DASHES = Array.from({ length: DASHES_SHOWN }, (_, i) => {
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
      pointerEvents="none"
    >
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
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor="#09CBEA" stopOpacity="0.22" />
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
            stroke="#09CBEA"
            strokeOpacity="0.28"
            strokeWidth="1.5"
          />
          <Path d={DASHES} fill="#09CBEA" fillOpacity="0.7" />
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

      {showRoad && (
        <>
          <Path
            d="M16 616 L33 577 Q45 564 71 558 L116 507 Q130 492 164 494 L201 501 Q222 507 248 555 L275 568 Q290 579 289 612 L281 629 H29 Z"
            fill="#0D3458"
            stroke="#3C82AD"
            strokeWidth="2"
          />
          <Path
            d="M81 554 L127 513 Q141 501 163 504 L196 511 L228 553 Z"
            fill="#07192D"
            stroke="#31719D"
            strokeWidth="2"
          />
          <Path
            d="M25 581 Q105 558 255 575"
            fill="none"
            stroke="#09CBEA"
            strokeOpacity="0.65"
            strokeWidth="2"
          />
          <Circle
            cx="70"
            cy="620"
            r="28"
            fill="#020A14"
            stroke="#204668"
            strokeWidth="4"
          />
          <Circle
            cx="70"
            cy="620"
            r="15"
            fill="#102941"
            stroke="#627B96"
            strokeWidth="2"
          />
          <Circle
            cx="240"
            cy="620"
            r="28"
            fill="#020A14"
            stroke="#204668"
            strokeWidth="4"
          />
          <Circle
            cx="240"
            cy="620"
            r="15"
            fill="#102941"
            stroke="#627B96"
            strokeWidth="2"
          />
          <Path
            d="M19 586 L66 586"
            stroke="#FF455B"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <Path
            d="M257 581 L277 584"
            stroke="#D9FAFF"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <Rect
            x="320"
            y="482"
            width="46"
            height="151"
            rx="13"
            fill="#071B31"
            stroke="#09CBEA"
            strokeWidth="2"
          />
          <Rect x="328" y="496" width="30" height="44" rx="5" fill="#0D3854" />
          <Path
            d="M346 502 L335 520 H345 L340 533 L353 513 H344 Z"
            fill="#25E3C0"
          />
          <Path
            d="M321 551 C293 551 299 591 270 588"
            fill="none"
            stroke="#25E3C0"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
      <Rect x="-200" y="470" width="800" height="330" fill="url(#fade)" />
    </Svg>
  );
}
