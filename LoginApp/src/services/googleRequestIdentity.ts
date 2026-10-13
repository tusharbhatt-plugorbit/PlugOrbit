import {NativeModules, Platform} from 'react-native';

/** Identity of the installed APK, including its actual debug/release signer. */
export function googleRequestIdentityHeaders(): Record<string, string> {
  if (Platform.OS !== 'android') {
    return {};
  }
  const identity = NativeModules.GoogleRequestIdentity as
    | {packageName?: string; certificateSha1?: string}
    | undefined;
  const packageName = identity?.packageName;
  const certificateSha1 = identity?.certificateSha1;
  if (!packageName || !certificateSha1 || !/^[A-Fa-f0-9]{40}$/.test(certificateSha1)) {
    throw new Error('Android signing identity is unavailable. Rebuild and reinstall the app.');
  }
  return {
    'X-Android-Package': packageName,
    'X-Android-Cert': certificateSha1.toUpperCase(),
  };
}
