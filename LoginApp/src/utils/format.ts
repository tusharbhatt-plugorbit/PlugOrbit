export function formatInr(amount: number, withDecimals = false): string {
  const fixed = withDecimals ? amount.toFixed(2) : String(Math.round(amount));
  const [int, dec] = fixed.split('.');
  // Indian digit grouping: 12,34,567
  let head = int;
  if (int.length > 3) {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    head = `${rest},${last3}`;
  }
  return `₹${head}${dec ? `.${dec}` : ''}`;
}

export function formatKwh(kwh: number): string {
  return `${kwh.toFixed(1)} kWh`;
}

export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function formatClock(epoch: number): string {
  const d = new Date(epoch);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatDate(epoch: number): string {
  const d = new Date(epoch);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatDateTime(epoch: number): string {
  return `${formatDate(epoch)}, ${formatClock(epoch)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}
