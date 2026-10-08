import React from 'react';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import type {ConnectorType} from '../domain/types';

type Props = {
  type: ConnectorType;
  size?: number;
  /** Pin colour; the selected state turns the pins lime. */
  pin?: string;
};

const HOUSING = '#1E293B';
const PIN = '#E2E8F0';

type Dot = readonly [x: number, y: number, r: number];

// Type 2 face: a circle with a flat top, five power pins and two signal pins.
const TYPE2_SHELL = 'M15.4 16 H48.6 A26 26 0 1 1 15.4 16 Z';
const TYPE2_PINS: readonly Dot[] = [
  [25, 24, 2.4],
  [39, 24, 2.4],
  [20, 36, 4],
  [32, 36, 4],
  [44, 36, 4],
  [26, 48, 4],
  [38, 48, 4],
];

// CCS2 face: the Type 2 shape above, plus two large DC pins below it.
const CCS2_SHELL = 'M16.9 11 H47.1 A22 22 0 1 1 16.9 11 Z';
const CCS2_PINS: readonly Dot[] = [
  [26, 18, 2],
  [38, 18, 2],
  [22, 27, 3],
  [32, 27, 3],
  [42, 27, 3],
  [27, 36, 3],
  [37, 36, 3],
  [22, 49, 5.2],
  [42, 49, 5.2],
];

// CHAdeMO: one big round face with two large DC pins and small signal pins.
const ROUND_SHELL = 'M32 5 A27 27 0 1 1 31.99 5 Z';
const CHADEMO_PINS: readonly Dot[] = [
  [21, 40, 6.5],
  [43, 40, 6.5],
  [20, 21, 2.4],
  [32, 17, 2.4],
  [44, 21, 2.4],
  [27, 29, 2.4],
  [37, 29, 2.4],
];

// GB/T: round face with a key notch on top, two large DC pins and signal pins.
const GBT_PINS: readonly Dot[] = [
  [21, 38, 6],
  [43, 38, 6],
  [22, 19, 2.4],
  [42, 19, 2.4],
  [28, 28, 2.4],
  [36, 28, 2.4],
  [32, 52, 2.4],
];

function Pins({dots, fill}: {dots: readonly Dot[]; fill: string}) {
  return (
    <>
      {dots.map(([cx, cy, r]) => (
        <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={fill} />
      ))}
    </>
  );
}

/**
 * A simple front-on picture of a charging connector (the plug's face), so a
 * driver can match it to the socket on their car. Drawn, not photographed:
 * recognisable shape and pin layout, nothing technical.
 */
export function ConnectorImage({type, size = 56, pin = PIN}: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {type === 'Type2' && (
        <>
          <Path d={TYPE2_SHELL} fill={HOUSING} />
          <Pins dots={TYPE2_PINS} fill={pin} />
        </>
      )}
      {(type === 'CCS2' || type === 'LECCS') && (
        <>
          <Path d={CCS2_SHELL} fill={HOUSING} />
          <Rect x="9" y="38" width="46" height="21" rx="10" fill={HOUSING} />
          <Pins dots={CCS2_PINS} fill={pin} />
        </>
      )}
      {type === 'CHAdeMO' && (
        <>
          <Path d={ROUND_SHELL} fill={HOUSING} />
          <Pins dots={CHADEMO_PINS} fill={pin} />
        </>
      )}
      {type === 'GBT' && (
        <>
          <Path d={ROUND_SHELL} fill={HOUSING} />
          <Rect x="28" y="3" width="8" height="7" rx="2" fill={HOUSING} />
          <Pins dots={GBT_PINS} fill={pin} />
        </>
      )}
    </Svg>
  );
}
