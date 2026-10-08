export type OpenState = 'open' | 'closed' | 'unknown';

const WINDOW =
  /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function minutesOfDay(hour: string, minute: string | undefined, ap: string) {
  let h = Number(hour) % 12;
  if (ap.toLowerCase() === 'pm') {
    h += 12;
  }
  return h * 60 + (minute ? Number(minute) : 0);
}

/**
 * Whether a station is open at `at`, read from the free-text hours the data
 * sources give ("Open 24/7", "Open 6 AM - 11 PM"). Uses the device's local
 * clock, which is the driver's own. Anything it cannot read is `unknown`:
 * never assumed open, never assumed closed.
 */
export function openStateAt(hours: string, at: number): OpenState {
  const text = hours.trim();
  if (/24\s*\/\s*7|24\s*hours?|always open/i.test(text)) {
    return 'open';
  }
  const m = WINDOW.exec(text);
  if (!m) {
    return 'unknown';
  }
  const open = minutesOfDay(m[1], m[2], m[3]);
  const close = minutesOfDay(m[4], m[5], m[6]);
  const d = new Date(at);
  const now = d.getHours() * 60 + d.getMinutes();
  if (open === close) {
    return 'open';
  }
  const inside =
    open < close ? now >= open && now < close : now >= open || now < close;
  return inside ? 'open' : 'closed';
}

export function isAlwaysOpen(hours: string): boolean {
  return /24\s*\/\s*7|24\s*hours?|always open/i.test(hours);
}
