import React from 'react';
import Svg, {
  Circle,
  Ellipse,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
} from 'react-native-svg';
import {ICON_DATA, IconName} from './iconData';

export type {IconName};

const TAGS = {
  path: Path,
  circle: Circle,
  line: Line,
  rect: Rect,
  polyline: Polyline,
  polygon: Polygon,
  ellipse: Ellipse,
} as const;

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Solid fill for icons that read better filled (star, heart, bolt). */
  filled?: boolean;
};

function IconBase({
  name,
  size = 20,
  color = '#0F172A',
  strokeWidth = 2,
  filled = false,
}: Props) {
  const node = ICON_DATA[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden>
      {node.map(([tag, attrs], i) => {
        const Tag = TAGS[tag as keyof typeof TAGS];
        return Tag ? <Tag key={i} {...(attrs as object)} /> : null;
      })}
    </Svg>
  );
}

export const Icon = React.memo(IconBase);
