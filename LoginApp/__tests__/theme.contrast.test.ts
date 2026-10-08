import {colors} from '../src/theme';

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Text/background pairs the screens actually use for small text (WCAG AA). */
const PAIRS: ReadonlyArray<[string, string, string]> = [
  ['muted on the body sheet', colors.muted, colors.body],
  ['muted on white', colors.muted, colors.surface],
  ['muted on inputs/pills', colors.muted, colors.slateSoft],
  ['muted on lime badges', colors.muted, colors.limeSoft],
  ['limeDark on the body sheet', colors.limeDark, colors.body],
  ['limeDark on white', colors.limeDark, colors.surface],
  ['limeDark on lime badges', colors.limeDark, colors.limeSoft],
  ['amber on estimated badges', colors.amber, colors.amberSoft],
  ['amber on the body sheet', colors.amber, colors.body],
  ['info on user-confirmed badges', colors.info, colors.infoSoft],
  ['danger on danger badges', colors.danger, colors.dangerSoft],
  ['lime on the dark header', colors.lime, colors.bg],
  ['placeholder grey on the dark header', colors.placeholder, colors.bg],
  ['ink on lime buttons', colors.ink, colors.lime],
];

describe('theme contrast', () => {
  test.each(PAIRS)('%s meets WCAG AA (4.5:1)', (_name, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
