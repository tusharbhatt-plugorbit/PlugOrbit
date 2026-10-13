import {NativeModules, Platform} from 'react-native';
import {OtpError} from './otpApi';
import type {CloudSession} from './session';

export const NATIVE_PHONE_REFRESH = 'native-firebase-phone';
export const hasNativePhoneAuth = () => Platform.OS === 'android' && !!NativeModules.PlugOrbitPhoneAuth;
const bridge = () => {
  const native = NativeModules.PlugOrbitPhoneAuth;
  if (Platform.OS !== 'android' || !native) throw new OtpError('PHONE_NOT_CONFIGURED', 'Mobile sign-in needs the updated Android app. Please use email for now.');
  return native;
};
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const phone = value.trim().startsWith('+') ? `+${digits}` : digits.length === 10 ? `+91${digits}` : `+${digits}`;
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new OtpError('PHONE_INVALID', 'Enter a valid mobile number with country code.');
  return phone;
}
function phoneError(error: unknown): OtpError {
  const failure = (error && typeof error === 'object' ? error : {}) as {code?: string; message?: string};
  if (/BILLING_NOT_ENABLED/i.test(`${failure.code ?? ''} ${failure.message ?? ''}`)) return new OtpError('PHONE_BILLING', 'Mobile sign-in is unavailable until PlugOrbit completes SMS billing setup. Please use email or Google sign-in.');
  const messages: Record<string, string> = {
    ERROR_OPERATION_NOT_ALLOWED: 'Phone sign-in must be enabled in the PlugOrbit Firebase project.',
    ERROR_INVALID_APP_CREDENTIAL: 'Phone verification configuration needs attention. Please use email sign-in.',
    ERROR_APP_NOT_AUTHORIZED: 'This Android signing certificate is not authorized for phone sign-in.',
    ERROR_TOO_MANY_REQUESTS: 'Too many requests. Please wait before trying again.',
    ERROR_QUOTA_EXCEEDED: 'SMS delivery quota is unavailable. Please use email sign-in.',
    ERROR_INVALID_VERIFICATION_CODE: 'The verification code is incorrect. Please try again.',
    ERROR_SESSION_EXPIRED: 'The verification code expired. Please request a new one.',
  };
  return new OtpError(failure.code || 'PHONE_AUTH_FAILED', messages[failure.code || ''] || failure.message || 'Phone verification could not finish.');
}
export async function requestPhoneCode(identifier: string, signal?: AbortSignal): Promise<{instant: boolean}> {
  if (signal?.aborted) throw new OtpError('ABORTED', 'Request cancelled.');
  const native = bridge();
  const cancel = () => {native.cancel().catch(() => {});};
  signal?.addEventListener('abort', cancel);
  try {
    const result = await native.sendCode(normalizePhone(identifier));
    if (signal?.aborted) throw new OtpError('ABORTED', 'Request cancelled.');
    return result;
  } catch (error) {throw phoneError(error);}
  finally {signal?.removeEventListener('abort', cancel);}
}
export async function verifyPhoneCode(code: string, signal?: AbortSignal): Promise<CloudSession> {
  if (signal?.aborted) throw new OtpError('ABORTED', 'Request cancelled.');
  try {
    const session = await bridge().verifyCode(code);
    if (signal?.aborted) throw new OtpError('ABORTED', 'Request cancelled.');
    if (!session?.uid || !session?.idToken || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) throw new OtpError('SESSION_UNAVAILABLE', 'Phone session is unavailable.');
    return {...session, refreshToken: NATIVE_PHONE_REFRESH};
  } catch (error) {throw phoneError(error);}
}
export function cancelPhoneVerification(): void {NativeModules.PlugOrbitPhoneAuth?.cancel().catch(() => {});}
