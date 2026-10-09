import {isAlwaysOpen, openStateAt} from '../../src/intelligence/hours';

const at = (h: number, m = 0) => new Date(2026, 0, 15, h, m).getTime();

describe('opening hours', () => {
  test('24/7 is always open', () => {
    expect(openStateAt('Open 24/7', at(3))).toBe('open');
    expect(isAlwaysOpen('Open 24/7')).toBe(true);
  });

  test('a daytime window', () => {
    const hours = 'Open 6 AM - 11 PM';
    expect(openStateAt(hours, at(5, 59))).toBe('closed');
    expect(openStateAt(hours, at(6))).toBe('open');
    expect(openStateAt(hours, at(22, 59))).toBe('open');
    expect(openStateAt(hours, at(23))).toBe('closed');
    expect(isAlwaysOpen(hours)).toBe(false);
  });

  test('an overnight window wraps past midnight', () => {
    const hours = 'Open 8 PM - 6 AM';
    expect(openStateAt(hours, at(23))).toBe('open');
    expect(openStateAt(hours, at(2))).toBe('open');
    expect(openStateAt(hours, at(12))).toBe('closed');
  });

  test('anything unreadable is unknown, never assumed open or closed', () => {
    expect(openStateAt('Hours unknown', at(12))).toBe('unknown');
    expect(openStateAt('', at(12))).toBe('unknown');
    expect(openStateAt('Mon-Fri', at(12))).toBe('unknown');
  });
});
