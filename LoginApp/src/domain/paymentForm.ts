// Client-side checks for the "add payment method" form. They only catch typos;
// a real gateway still verifies the method (TODO(integration): tokenised card
// capture and UPI collect-request verification in the payment gateway).

const UPI_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,48}@[a-zA-Z][a-zA-Z0-9]{1,30}$/;

export function validateUpiId(raw: string): string | null {
  const id = raw.trim();
  if (id === '') {
    return 'Enter your UPI ID, for example name@bank.';
  }
  if (!UPI_ID.test(id)) {
    return 'That doesn’t look like a UPI ID. It should read name@bank.';
  }
  return null;
}

/**
 * "ravi.k@okaxis" -> "ra•••k@okaxis": enough to recognise (and to tell two IDs
 * apart), not to reuse. Handles of 3 characters or fewer are fully hidden.
 */
export function maskUpi(raw: string): string {
  const id = raw.trim();
  const at = id.indexOf('@');
  if (at < 1) {
    return '••••';
  }
  const local = id.slice(0, at);
  if (local.length <= 3) {
    return `•••${id.slice(at)}`;
  }
  return `${local.slice(0, 2)}${'•'.repeat(local.length - 3)}${local.slice(
    -1,
  )}${id.slice(at)}`;
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Standard Luhn checksum used by all card networks. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export type CardBrand = 'Visa' | 'Mastercard' | 'RuPay' | 'Amex' | 'Card';

export function cardBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) {
    return 'Visa';
  }
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(digits)) {
    return 'Mastercard';
  }
  if (/^3[47]/.test(digits)) {
    return 'Amex';
  }
  if (/^(60|65|81|82|508)/.test(digits)) {
    return 'RuPay';
  }
  return 'Card';
}

export function validateCardNumber(raw: string): string | null {
  const digits = digitsOnly(raw);
  if (digits === '') {
    return 'Enter your card number.';
  }
  if (!luhnValid(digits)) {
    return 'That card number doesn’t look right. Check it and try again.';
  }
  return null;
}

/** Groups digits in fours as the user types: 4242 4242 4242 4242. */
export function formatCardNumber(raw: string): string {
  return digitsOnly(raw)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Inserts the slash as the user types: 1226 -> 12/26. */
export function formatExpiry(raw: string): string {
  const d = digitsOnly(raw).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function validateExpiry(raw: string, now = new Date()): string | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(raw.trim());
  if (!m) {
    return 'Enter the expiry as MM/YY.';
  }
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) {
    return 'The month must be between 01 and 12.';
  }
  // A card is valid through the last day of its expiry month.
  const lastValid = new Date(year, month, 0, 23, 59, 59);
  if (lastValid.getTime() < now.getTime()) {
    return 'This card has expired.';
  }
  if (year > now.getFullYear() + 20) {
    return 'That expiry date is too far away.';
  }
  return null;
}
