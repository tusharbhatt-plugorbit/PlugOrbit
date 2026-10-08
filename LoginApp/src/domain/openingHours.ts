/**
 * Opening hours arrive as free text from the station table ("Open 24/7",
 * "Open 6 AM - 11 PM", "Hours unknown"). Returns whether the charger is open at
 * `at`, or null when the text doesn't say: unknown is never treated as closed
 * (that would hide working chargers) and never as open (that would send a
 * driver to a locked gate), so callers show it as "hours unconfirmed".
 */
const RANGE =
  /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function minutesOfDay(h: string, m: string | undefined, ampm: string): number {
  let hour = Number(h) % 12;
  if (ampm.toLowerCase() === 'pm') {
    hour += 12;
  }
  return hour * 60 + (m ? Number(m) : 0);
}

export function isOpenAt(hours: string, at: number): boolean | null {
  if (/24\s*\/\s*7|24\s*hours?|always open/i.test(hours)) {
    return true;
  }
  const match = RANGE.exec(hours);
  if (!match) {
    return null;
  }
  const open = minutesOfDay(match[1], match[2], match[3]);
  const close = minutesOfDay(match[4], match[5], match[6]);
  const d = new Date(at);
  const now = d.getHours() * 60 + d.getMinutes();
  if (open === close) {
    return true;
  }
  // A window that runs past midnight ("6 PM - 2 AM").
  return open < close ? now >= open && now < close : now >= open || now < close;
}

export function opensLabel(hours: string): string {
  return /^open\s/i.test(hours) ? hours : `Open ${hours}`;
}
