import {Linking} from 'react-native';
import {API_BASE_URL} from '../config/api';
import {OtpError} from './otpApi';
import {sessionFromVerify} from './session';
import type {CloudSession} from './session';
async function call(path: string, options: RequestInit, signal?: AbortSignal) {
  const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort',abort);if(signal?.aborted)abort();
  const timer=setTimeout(abort,15000);
  try {
    const response=await fetch(`${API_BASE_URL}${path}`,{...options,signal:controller.signal});
    const body=await response.json();
    if(!response.ok)throw new OtpError('GOOGLE_BROWSER',body.detail?.message ?? 'Google sign-in could not connect.');
    return body;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function signInWithGoogleBrowser(signal?: AbortSignal): Promise<CloudSession | null> {
  if(signal?.aborted)return null;
  try {
    const flow=await call('/auth/google-browser/start',{method:'POST'},signal);
    if(typeof flow.flow_id!=='string'||! /^[A-Za-z0-9_-]{16,80}$/.test(flow.flow_id)||typeof flow.poll_secret!=='string')throw new Error('Invalid sign-in request.');
    if(signal?.aborted)return null;
    await Linking.openURL(`${API_BASE_URL}/auth/google-browser/page?flow=${encodeURIComponent(flow.flow_id)}`);
    const until=Date.now()+240000;
    while(Date.now()<until && !signal?.aborted) {
      const reply=await call(`/auth/google-browser/poll/${encodeURIComponent(flow.flow_id)}`,{method:'GET',headers:{'X-Poll-Secret':flow.poll_secret}},signal);
      if(signal?.aborted)return null;
      if(reply.status==='complete') {
        const session=sessionFromVerify(reply.session);
        if(!session)throw new OtpError('SESSION_UNAVAILABLE','Google signed in, but the app session is missing.');
        return session;
      }
      if(reply.status==='failed')throw new OtpError('GOOGLE_BROWSER',reply.message ?? 'Google sign-in failed.');
      await new Promise<void>(resolve => {
        const done = () => {clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
        const timer = setTimeout(done,1500);signal?.addEventListener('abort',done);
      });
    }
    if(signal?.aborted)return null;
    throw new OtpError('GOOGLE_TIMEOUT','Google sign-in expired. Return to PlugOrbit and retry.');
  } catch(error) {
    if(signal?.aborted)return null;
    if(error instanceof OtpError)throw error;
    throw new OtpError('NETWORK','Could not open browser sign-in. Check your connection and retry.');
  }
}
