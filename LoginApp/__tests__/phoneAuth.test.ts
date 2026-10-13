import {NativeModules, Platform} from 'react-native';
import {cancelPhoneVerification, normalizePhone, requestPhoneCode, verifyPhoneCode} from '../src/services/phoneAuth';

const native = {sendCode: jest.fn(), verifyCode: jest.fn(), cancel: jest.fn().mockResolvedValue(null)};
beforeEach(() => {jest.replaceProperty(Platform, 'OS', 'android'); jest.clearAllMocks(); NativeModules.PlugOrbitPhoneAuth = native;});
afterEach(() => {delete NativeModules.PlugOrbitPhoneAuth; jest.restoreAllMocks();});

test('normalizes Indian and international numbers without changing their country code', () => {
  expect(normalizePhone('98765 43210')).toBe('+919876543210');
  expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  expect(() => normalizePhone('123')).toThrow();
});
test('requests a real SMS without returning a development code', async () => {
  native.sendCode.mockResolvedValue({instant: false});
  expect(await requestPhoneCode('9876543210')).toEqual({instant: false});
  expect(native.sendCode).toHaveBeenCalledWith('+919876543210');
});
test('returns a native Firebase session with refresh delegated to the SDK', async () => {
  native.verifyCode.mockResolvedValue({uid: 'u', idToken: 't', expiresAt: Date.now() + 3600000});
  expect(await verifyPhoneCode('123456')).toMatchObject({uid: 'u', refreshToken: 'native-firebase-phone'});
});
test('rejects expired or malformed native sessions', async () => {
  native.verifyCode.mockResolvedValue({uid: 'u', idToken: 't', expiresAt: 1});
  await expect(verifyPhoneCode('123456')).rejects.toMatchObject({code: 'SESSION_UNAVAILABLE'});
});
test('does not authenticate an aborted verification', async () => {
  const controller = new AbortController();
  native.verifyCode.mockImplementation(async () => {controller.abort(); return {uid: 'u', idToken: 't', expiresAt: Date.now() + 3600000};});
  await expect(verifyPhoneCode('123456', controller.signal)).rejects.toMatchObject({code: 'ABORTED'});
});

test('billing rejection offers working sign-in alternatives without a fake code', async () => {
  native.sendCode.mockRejectedValue({code: 'ERROR_INTERNAL_ERROR', message: 'BILLING_NOT_ENABLED'});
  await expect(requestPhoneCode('9876543210')).rejects.toMatchObject({code: 'PHONE_BILLING', message: expect.stringContaining('email or Google')});
});
test('cancelling never throws: no module, a module without cancel, or a synchronous failure', () => {
  delete NativeModules.PlugOrbitPhoneAuth;
  expect(() => cancelPhoneVerification()).not.toThrow();
  NativeModules.PlugOrbitPhoneAuth = {sendCode: jest.fn()};
  expect(() => cancelPhoneVerification()).not.toThrow();
  NativeModules.PlugOrbitPhoneAuth = {cancel: () => {throw new Error('native bridge down');}};
  expect(() => cancelPhoneVerification()).not.toThrow();
  NativeModules.PlugOrbitPhoneAuth = native;
  cancelPhoneVerification();
  expect(native.cancel).toHaveBeenCalledTimes(1);
});
