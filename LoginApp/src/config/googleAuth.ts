import {GOOGLE_SIGN_IN_MODE, GOOGLE_SIGN_IN_WEB_CLIENT_ID} from '@env';
export const googleSignInWebClientId = (GOOGLE_SIGN_IN_WEB_CLIENT_ID ?? '').trim();

export const googleSignInUseBrowser = (GOOGLE_SIGN_IN_MODE ?? '').trim() === 'browser';
