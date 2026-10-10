import React from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import {colors} from '../theme';

/**
 * Vector scenes for the first-run screens. They are decorative: no figures, no
 * place names, nothing that could be read as live data. Everything is drawn from
 * theme colours so a palette change reaches them too.
 */

const LINE = '#1E2D49'; // faint map lines on the navy card: a step above bgRaised
const BOLT = 'M2 -9 L-5 1 H0 L-2 9 L5 -1 H0 Z';
// Teardrop map pin, tip at the origin, head ~ (0,-22).
const PIN =
  'M0 0 C -2 -4 -14 -12 -14 -24 C -14 -32 -8 -38 0 -38 C 8 -38 14 -32 14 -24 C 14 -12 2 -4 0 0 Z';

type Box = {style?: object};

function Frame({
  children,
  viewBox,
  style,
}: {
  children: React.ReactNode;
  viewBox: string;
  style?: object;
}) {
  return (
    <View
      style={[styles.frame, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet">
        {children}
      </Svg>
    </View>
  );
}

/** Welcome hero: a route with one intelligent charging stop on the way. */
export function RouteHeroIllustration({style}: Box) {
  return (
    <Frame viewBox="0 0 360 250" style={style}>
      <Defs>
        <RadialGradient
          id="stopGlow"
          cx="180"
          cy="122"
          rx="90"
          ry="90"
          gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.lime} stopOpacity="0.32" />
          <Stop offset="1" stopColor={colors.lime} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="180" cy="122" r="90" fill="url(#stopGlow)" />
      {/* Orbit rings around the stop: the brand idea. */}
      <Circle
        cx="180"
        cy="122"
        r="46"
        fill="none"
        stroke={colors.lime}
        strokeOpacity="0.22"
      />
      <Circle
        cx="180"
        cy="122"
        r="72"
        fill="none"
        stroke={colors.lime}
        strokeOpacity="0.12"
      />
      {/* The route. */}
      <Path
        d="M40 204 C 96 204, 104 130, 180 122 S 262 58, 322 56"
        fill="none"
        stroke={colors.lime}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 9"
      />
      <Path
        d="M40 204 C 96 204, 104 130, 180 122"
        fill="none"
        stroke={colors.lime}
        strokeWidth="3"
        strokeLinecap="round"
        strokeOpacity="0.9"
      />
      {/* Start. */}
      <Circle cx="40" cy="204" r="14" fill={colors.lime} fillOpacity="0.14" />
      <Circle cx="40" cy="204" r="7" fill="#FFFFFF" />
      {/* The charging stop. */}
      <Circle cx="180" cy="122" r="22" fill={colors.lime} />
      <G transform="translate(180 122)">
        <Path d={BOLT} fill={colors.bg} />
      </G>
      {/* Destination. */}
      <G transform="translate(322 62)">
        <Path d={PIN} fill="#FFFFFF" />
        <Circle cx="0" cy="-24" r="6" fill={colors.bg} />
      </G>
    </Frame>
  );
}

function Card({children}: {children: React.ReactNode}) {
  return (
    <>
      <Rect
        x="14"
        y="10"
        width="292"
        height="200"
        rx="24"
        fill={colors.bgRaised}
      />
      <Rect
        x="14.5"
        y="10.5"
        width="291"
        height="199"
        rx="23.5"
        fill="none"
        stroke={colors.lime}
        strokeOpacity="0.2"
      />
      {children}
    </>
  );
}

/** Onboarding 1: chargers around you, matched to your car. */
export function FindChargersIllustration({style}: Box) {
  return (
    <Frame viewBox="0 0 320 220" style={style}>
      <Card>
        {/* Streets. */}
        <Path
          d="M14 150 C 90 130, 150 170, 306 120"
          stroke={LINE}
          strokeWidth="10"
          fill="none"
        />
        <Path
          d="M120 10 C 130 70, 100 140, 150 210"
          stroke={LINE}
          strokeWidth="10"
          fill="none"
        />
        <Path d="M230 10 L 250 210" stroke={LINE} strokeWidth="6" fill="none" />
        <Path d="M14 70 L306 90" stroke={LINE} strokeWidth="6" fill="none" />
        {/* Other chargers. */}
        <G transform="translate(74 100)">
          <Path d={PIN} fill="#3A4E72" />
          <Circle cx="0" cy="-24" r="5" fill={colors.bgRaised} />
        </G>
        <G transform="translate(258 140)">
          <Path d={PIN} fill="#3A4E72" />
          <Circle cx="0" cy="-24" r="5" fill={colors.bgRaised} />
        </G>
        {/* The one that fits your car. */}
        <Circle cx="190" cy="92" r="30" fill={colors.lime} fillOpacity="0.12" />
        <G transform="translate(190 112) scale(1.35)">
          <Path d={PIN} fill={colors.lime} />
          <G transform="translate(0 -24) scale(0.8)">
            <Path d={BOLT} fill={colors.bg} />
          </G>
        </G>
        {/* A tick: compatible. */}
        <Circle cx="222" cy="52" r="13" fill="#FFFFFF" />
        <Path
          d="M216 52 L220.5 56.5 L228.5 47.5"
          fill="none"
          stroke={colors.bg}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* You. */}
        <Circle cx="128" cy="168" r="16" fill="#FFFFFF" fillOpacity="0.12" />
        <Circle cx="128" cy="168" r="7" fill="#FFFFFF" />
      </Card>
    </Frame>
  );
}

/** Onboarding 2: start, one planned stop, destination, and the charge in between. */
export function SmartJourneyIllustration({style}: Box) {
  return (
    <Frame viewBox="0 0 320 220" style={style}>
      <Card>
        <Path
          d="M48 150 C 90 150, 110 78, 160 78 S 232 70, 272 70"
          fill="none"
          stroke={colors.lime}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="1 9"
        />
        <Path
          d="M48 150 C 90 150, 110 78, 160 78"
          fill="none"
          stroke={colors.lime}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Circle cx="48" cy="150" r="12" fill={colors.lime} fillOpacity="0.15" />
        <Circle cx="48" cy="150" r="6" fill="#FFFFFF" />
        <Circle cx="160" cy="78" r="21" fill={colors.lime} />
        <G transform="translate(160 78)">
          <Path d={BOLT} fill={colors.bg} />
        </G>
        <G transform="translate(272 76)">
          <Path d={PIN} fill="#FFFFFF" />
          <Circle cx="0" cy="-24" r="6" fill={colors.bgRaised} />
        </G>
        {/* A battery: charge enough to arrive, not more. */}
        <Rect
          x="62"
          y="168"
          width="156"
          height="24"
          rx="8"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.5"
          strokeWidth="2"
        />
        <Rect
          x="220"
          y="175"
          width="5"
          height="10"
          rx="2"
          fill="#FFFFFF"
          fillOpacity="0.5"
        />
        <Rect x="67" y="173" width="32" height="14" rx="4" fill={colors.lime} />
        <Rect
          x="103"
          y="173"
          width="32"
          height="14"
          rx="4"
          fill={colors.lime}
        />
        <Rect
          x="139"
          y="173"
          width="32"
          height="14"
          rx="4"
          fill={colors.lime}
          fillOpacity="0.55"
        />
        <Rect
          x="175"
          y="173"
          width="38"
          height="14"
          rx="4"
          fill="#FFFFFF"
          fillOpacity="0.1"
        />
      </Card>
    </Frame>
  );
}

/** Onboarding 3: Orbit Assist, circling the plan and keeping it right. */
export function OrbitAssistIllustration({style}: Box) {
  return (
    <Frame viewBox="0 0 320 220" style={style}>
      <Defs>
        <RadialGradient
          id="oaGlow"
          cx="160"
          cy="110"
          rx="110"
          ry="110"
          gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.lime} stopOpacity="0.26" />
          <Stop offset="1" stopColor={colors.lime} stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="oaCore" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#C7F79B" />
          <Stop offset="1" stopColor={colors.lime} />
        </LinearGradient>
      </Defs>
      <Card>
        <Circle cx="160" cy="110" r="98" fill="url(#oaGlow)" />
        <Circle
          cx="160"
          cy="110"
          r="38"
          fill="none"
          stroke={colors.lime}
          strokeOpacity="0.35"
        />
        <Circle
          cx="160"
          cy="110"
          r="66"
          fill="none"
          stroke={colors.lime}
          strokeOpacity="0.22"
          strokeDasharray="2 6"
        />
        <Circle
          cx="160"
          cy="110"
          r="92"
          fill="none"
          stroke={colors.lime}
          strokeOpacity="0.12"
        />
        <Circle cx="160" cy="110" r="26" fill="url(#oaCore)" />
        <G transform="translate(160 110) scale(1.5)">
          <Path d={BOLT} fill={colors.bg} />
        </G>
        {/* Things it keeps an eye on. */}
        <Circle cx="217" cy="64" r="9" fill="#FFFFFF" />
        <Circle cx="102" cy="150" r="9" fill="#FFFFFF" />
        <Circle cx="236" cy="152" r="7" fill={colors.lime} />
        <Circle cx="92" cy="74" r="6" fill={colors.lime} fillOpacity="0.7" />
        <Line
          x1="217"
          y1="64"
          x2="186"
          y2="95"
          stroke={colors.lime}
          strokeOpacity="0.3"
        />
        <Line
          x1="102"
          y1="150"
          x2="136"
          y2="127"
          stroke={colors.lime}
          strokeOpacity="0.3"
        />
      </Card>
    </Frame>
  );
}

const styles = StyleSheet.create({
  frame: {width: '100%', aspectRatio: 1.45},
});
