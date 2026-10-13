import {colors} from '../src/theme';
import {darkColors, recolor} from '../src/appearance';

function lum(hex: string): number {
  const rgba = hex.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  const n = parseInt(hex.slice(1), 16);
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (rgba) {
    // Translucent cards are drawn over the body sheet; evaluate the rendered color.
    const backdrop = parseInt(colors.body.slice(1), 16);
    const base = [(backdrop >> 16) & 255, (backdrop >> 8) & 255, backdrop & 255];
    const alpha = Number(rgba[4]);
    rgb = base.map((v, i) => Number(rgba[i + 1]) * alpha + v * (1 - alpha));
  }
  const ch = rgb.map(v => {
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
  [
    'light-input placeholder on white',
    colors.placeholderOnLight,
    colors.surface,
  ],
  [
    'light-input placeholder on input fill',
    colors.placeholderOnLight,
    colors.inputBg,
  ],
  [
    'light-input placeholder on the body sheet',
    colors.placeholderOnLight,
    colors.body,
  ],
  ['error on the dark raised surface', colors.dangerOnDark, colors.bgRaised],
  ['secondary text on the dark header', colors.onDarkMuted, colors.bg],
  ['ink on lime buttons', colors.ink, colors.lime],
];

describe('theme contrast', () => {
  test.each(PAIRS)('%s meets WCAG AA (4.5:1)', (_name, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

for (const [name, palette] of [['Light',colors],['System dark',darkColors]] as const) {
 describe(`${name} control visibility`,()=>{
  test.each([
   ['card text',palette.ink,palette.surface],
   ['card secondary text',palette.muted,palette.surface],
   ['input placeholder',palette.placeholderOnLight,palette.surface],
   ['inactive tab text',palette.inkSoft,palette.inputBg],
   ['selected tab text',palette.onControlActive,palette.controlActive],
   ['selected chip text',palette.onAccent,palette.lime],
   ['soft selected card text',palette.ink,palette.limeSoft],
   ['info badge text',palette.info,palette.infoSoft],
  ])('%s stays readable',(_label,fg,bg)=>{expect(ratio(fg,bg)).toBeGreaterThanOrEqual(4.5);});
  test.each([['input boundary',palette.inputBorder,palette.surface],['card boundary',palette.inputBorder,palette.body]])('%s is visible',(_label,fg,bg)=>{expect(ratio(fg,bg)).toBeGreaterThanOrEqual(3);});
 });
}
it('preserves the dark foreground of mint controls while recoloring ordinary text',()=>{
 const style=recolor({selected:{color:colors.onAccent,backgroundColor:colors.lime},regular:{color:colors.ink},tile:{backgroundColor:'#F1F5F9'}},darkColors);
 expect(ratio(style.selected.color,style.selected.backgroundColor)).toBeGreaterThanOrEqual(4.5);
 expect(style.regular.color).toBe(darkColors.ink);
 expect(style.tile.backgroundColor).toBe(darkColors.inputBg);
});

it('keeps white hero headings white when opaque white cards become dark surfaces',()=>{
 const style=recolor({heading:{color:'#FFFFFF'},card:{backgroundColor:'#FFFFFF'}},darkColors);
 expect(style.heading.color).toBe('#FFFFFF');
 expect(style.card.backgroundColor).toBe(darkColors.surface);
 expect(ratio(style.heading.color,darkColors.bg)).toBeGreaterThanOrEqual(4.5);
});

// The dark appearance recolors styles by colour value. Two tokens that share a value but
// differ in dark would therefore be recolored identically, so a shared value is only
// allowed where recolor() resolves the clash from the style property (text vs fill):
// white is `surface` as a fill and `road` as map art; E2E8F0 is `chipText` as text and
// `slateSoft` as a fill. Anything else must have its own value (this is how a text colour
// on lime once turned light in dark mode).
it('gives every token that recolors differently its own colour value', () => {
  const byValue: Record<string, string[]> = {};
  (Object.keys(colors) as (keyof typeof colors)[]).forEach(k => {
    (byValue[colors[k]] ||= []).push(`${k}=${darkColors[k]}`);
  });
  const allowed = new Set(['#FFFFFF', '#E2E8F0']);
  const clashes = Object.entries(byValue)
    .filter(([hex, tokens]) => !allowed.has(hex) && new Set(tokens.map(t => t.split('=')[1])).size > 1)
    .map(([hex, tokens]) => `${hex}: ${tokens.join(', ')}`);
  expect(clashes).toEqual([]);
});
