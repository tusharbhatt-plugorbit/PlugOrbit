import {OtpError} from '../../services/otpApi';

export type IdentifierType = 'email' | 'phone';

export const OTP_LENGTH = 6;
export const RESEND_SECONDS = 30;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Decide whether the user typed an email address or a mobile number. */
export function detectIdentifierType(value: string): IdentifierType | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes('@')) {
    return EMAIL_REGEX.test(trimmed) ? 'email' : null;
  }
  if (/^\+?[\d\s()-]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? 'phone' : null;
  }
  return null;
}

/** What to tell the user about the identifier field, or null when it is fine. */
export function identifierProblem(value: string): string | null {
  if (!value.trim()) {
    return 'Enter your mobile number or email address.';
  }
  return detectIdentifierType(value)
    ? null
    : 'That doesn’t look like a valid mobile number or email address.';
}

/** What to tell the user about the code field, or null when it is complete. */
export function codeProblem(code: string): string | null {
  return code.length === OTP_LENGTH
    ? null
    : `Enter the ${OTP_LENGTH}-digit code.`;
}

export function authErrorMessage(e: unknown): string {
  return e instanceof OtpError
    ? e.message
    : 'Something went wrong. Please try again.';
}

/** Codes the Backend sends when the typed code itself was refused. */
export function isCodeRejection(e: unknown): boolean {
  return (
    e instanceof OtpError &&
    (e.code === 'OTP_INVALID' ||
      e.code === 'OTP_EXPIRED' ||
      e.code === 'OTP_TOO_MANY_ATTEMPTS')
  );
}
