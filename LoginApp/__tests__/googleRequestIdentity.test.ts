import {NativeModules, Platform} from 'react-native';
import {googleRequestIdentityHeaders} from '../src/services/googleRequestIdentity';

const originalOs = Platform.OS;
const originalIdentity = NativeModules.GoogleRequestIdentity;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', {value: originalOs, configurable: true});
  NativeModules.GoogleRequestIdentity = originalIdentity;
});

test('uses the installed package and signer, without certificate delimiters', () => {
  Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true});
  NativeModules.GoogleRequestIdentity = {
    packageName: 'com.loginapp.release',
    certificateSha1: 'a'.repeat(40),
  };
  expect(googleRequestIdentityHeaders()).toEqual({
    'X-Android-Package': 'com.loginapp.release',
    'X-Android-Cert': 'A'.repeat(40),
  });
});

test('requires a rebuild when the native identity module is missing', () => {
  Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true});
  NativeModules.GoogleRequestIdentity = undefined;
  expect(googleRequestIdentityHeaders).toThrow('Rebuild and reinstall');
});

test('rejects malformed certificate fingerprints', () => {
  Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true});
  NativeModules.GoogleRequestIdentity = {packageName: 'com.loginapp', certificateSha1: 'bad'};
  expect(googleRequestIdentityHeaders).toThrow('signing identity');
});

test('does not send Android identity for other platforms', () => {
  Object.defineProperty(Platform, 'OS', {value: 'ios', configurable: true});
  expect(googleRequestIdentityHeaders()).toEqual({});
});
