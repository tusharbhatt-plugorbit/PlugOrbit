import {Platform} from 'react-native';
import {API_BASE_URL as ENV_API_BASE_URL} from '@env';

// Inlined from .env at bundle time (restart Metro with --reset-cache after
// changing it). Empty means "use the local development default".
// The Android emulator reaches the host machine at 10.0.2.2; the iOS simulator
// shares the host's localhost. A real device needs the host's LAN IP in .env.
const DEFAULT_API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';

/** Base URL of the PlugOrbit Backend, without a trailing slash. */
export const API_BASE_URL: string = (
  (ENV_API_BASE_URL ?? '').trim() || DEFAULT_API_BASE_URL
).replace(/\/+$/, '');
