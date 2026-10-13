import {signInWithGoogleBrowser} from './googleBrowserSignIn';
import {googleSignInUseBrowser, googleSignInWebClientId} from '../config/googleAuth';
import {GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes} from '@react-native-google-signin/google-signin';
import {API_BASE_URL} from '../config/api';
import {OtpError} from './otpApi';
import {sessionFromVerify} from './session';
import type {CloudSession} from './session';

export async function signInWithGoogle(signal?: AbortSignal): Promise<CloudSession | null> {
  if (googleSignInUseBrowser) return signInWithGoogleBrowser(signal);
  const clientId = googleSignInWebClientId;
  if (!clientId) {
    throw new OtpError('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not enabled yet. Please use email sign-in.');
  }
  if (signal?.aborted) {return null;}
  try {
    GoogleSignin.configure({webClientId: clientId});
    await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
    const result = await GoogleSignin.signIn();
    if (!isSuccessResponse(result) || signal?.aborted) {return null;}
    if (!result.data.idToken) {throw new OtpError('GOOGLE_TOKEN_MISSING', 'Google could not verify your account. Please try again.');}
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) {controller.abort();}
    const timer = setTimeout(abort, 30_000);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({id_token: result.data.idToken}), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new OtpError(body?.detail?.code ?? 'GOOGLE_AUTH_FAILED', body?.detail?.message ?? 'Google sign-in could not finish. Try again.');
      }
      const session = sessionFromVerify(body);
      if (!session) {throw new OtpError('SESSION_UNAVAILABLE', 'Google signed in, but the server could not open your session.');}
      return session;
    } finally {clearTimeout(timer); signal?.removeEventListener('abort', abort);}
  } catch (error) {
    if (signal?.aborted) {return null;}
    if (error instanceof OtpError) {throw error;}
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {return null;}
      if (String(error.code) === '10' || String(error.code) === 'DEVELOPER_ERROR') {
        return signInWithGoogleBrowser(signal);
      }
      if (error.code === statusCodes.IN_PROGRESS) {return null;}
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new OtpError('GOOGLE_PLAY_SERVICES', 'Update Google Play services, then try again.');
      }
      throw new OtpError('GOOGLE_AUTH_FAILED', 'Google sign-in could not start. Please use email sign-in for now.');
    }
    throw new OtpError('NETWORK', 'Could not reach the sign-in server. Please try again.');
  }
}
