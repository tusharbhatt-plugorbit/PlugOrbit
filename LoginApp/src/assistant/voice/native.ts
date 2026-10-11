import {Linking, PermissionsAndroid, Platform} from 'react-native';
import type {PermissionState} from '../types';
import type {
  AudioSessionPort,
  PermissionPort,
  RecognizerErrorCode,
  RecognizerEvents,
  SpeakResult,
  SpeechRecognizerPort,
  SpeechSynthesizerPort,
  VoiceDeps,
} from './ports';

/**
 * Adapters from the two native speech libraries to the ports the conversation
 * uses. The libraries are loaded lazily and defensively: if one is missing from
 * a build, or does not work on a phone, its port reports "unavailable" and
 * Orbit Assist carries on with typing. Nothing here records or keeps audio:
 * recognition happens in the operating system's own service.
 *
 *   speech to text   @react-native-voice/voice   Android SpeechRecognizer, iOS SFSpeechRecognizer
 *   text to speech   react-native-tts            Android TextToSpeech, iOS AVSpeechSynthesizer
 *
 * Both are classic native modules. They are the only files that import them, so
 * a replacement (for example expo-speech-recognition) changes this file alone.
 */

type Loader<T> = () => T | null;

const loadVoice: Loader<any> = () => {
  try {
    const m = require('@react-native-voice/voice');
    return m.default ?? m;
  } catch {
    return null;
  }
};

const loadTts: Loader<any> = () => {
  try {
    const m = require('react-native-tts');
    return m.default ?? m;
  } catch {
    return null;
  }
};

// -------------------------------------------------------------- recognizer ---

/**
 * Both platforms report failures as a code and/or message. Android uses the
 * SpeechRecognizer.ERROR_* numbers ("7/No match"); iOS uses text.
 */
export function mapRecognizerError(
  raw: {code?: unknown; message?: unknown} | undefined,
): RecognizerErrorCode {
  const code = String(raw?.code ?? '').trim();
  const message = String(raw?.message ?? '').toLowerCase();
  const lead = (message.match(/^(\d+)\s*\//)?.[1] ?? code).trim();
  switch (lead) {
    case '6': // ERROR_SPEECH_TIMEOUT
    case '7': // ERROR_NO_MATCH
    case '1110': // iOS: no speech detected
      return 'no_speech';
    case '9': // ERROR_INSUFFICIENT_PERMISSIONS
      return 'permission';
    case '1': // ERROR_NETWORK_TIMEOUT
    case '2': // ERROR_NETWORK
    case '4': // ERROR_SERVER
      return 'network';
    case '8': // ERROR_RECOGNIZER_BUSY
    case '3': // ERROR_AUDIO (microphone held by something else)
      return 'busy';
    case '12': // ERROR_LANGUAGE_NOT_SUPPORTED
    case '13': // ERROR_LANGUAGE_UNAVAILABLE
      return 'unavailable';
    default:
      break;
  }
  if (/permission|not authori[sz]ed|denied/.test(message)) {
    return 'permission';
  }
  if (/no speech|didn't hear|did not hear|no match/.test(message)) {
    return 'no_speech';
  }
  if (/network|connection|internet/.test(message)) {
    return 'network';
  }
  if (/busy|in use|interrupted/.test(message)) {
    return 'busy';
  }
  if (/disabled|not available|unavailable|not supported/.test(message)) {
    return 'unavailable';
  }
  return 'unknown';
}

/** If the engine says nothing at all this long after start(), treat it as broken. */
export const RECOGNIZER_WATCHDOG_MS = 6000;

export function createNativeRecognizer(
  load: Loader<any> = loadVoice,
): SpeechRecognizerPort {
  let cancelled = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };
  const detach = (v: any) => {
    clearWatchdog();
    try {
      v.removeAllListeners?.();
    } catch {
      // nothing attached
    }
  };

  return {
    async isAvailable() {
      const v = load();
      if (!v) {
        return false;
      }
      try {
        return !!(await v.isAvailable());
      } catch {
        return false;
      }
    },

    async start(locale: string, events: RecognizerEvents) {
      const v = load();
      if (!v) {
        events.onError(
          'unavailable',
          'Speech recognition is not part of this build.',
        );
        return;
      }
      cancelled = false;
      detach(v);
      let heardAnything = false;
      const alive = () => {
        heardAnything = true;
        clearWatchdog();
        return !cancelled;
      };
      v.onSpeechStart = () => {
        alive();
      };
      v.onSpeechPartialResults = (e: {value?: string[]}) => {
        if (alive() && e?.value?.[0]) {
          events.onPartial(e.value[0]);
        }
      };
      v.onSpeechResults = (e: {value?: string[]}) => {
        if (alive()) {
          events.onFinal(e?.value?.[0] ?? '');
        }
      };
      v.onSpeechVolumeChanged = (e: {value?: number}) => {
        if (alive() && typeof e?.value === 'number') {
          // Android reports roughly -2..10 dB, iOS differs; this only drives an animation.
          events.onLevel?.(Math.max(0, Math.min(1, (e.value + 2) / 12)));
        }
      };
      v.onSpeechError = (e: {error?: {code?: unknown; message?: unknown}}) => {
        if (alive()) {
          events.onError(
            mapRecognizerError(e?.error),
            String(e?.error?.message ?? ''),
          );
        }
      };
      v.onSpeechEnd = () => {
        if (alive()) {
          events.onEnd();
        }
      };
      watchdog = setTimeout(() => {
        if (!heardAnything && !cancelled) {
          cancelled = true;
          v.cancel?.().catch?.(() => undefined);
          events.onError('unavailable', 'The speech service did not start.');
        }
      }, RECOGNIZER_WATCHDOG_MS);
      try {
        await v.start(locale);
      } catch (e: any) {
        clearWatchdog();
        events.onError(
          mapRecognizerError({code: e?.code, message: e?.message}),
          String(e?.message ?? ''),
        );
      }
    },

    async stop() {
      const v = load();
      if (v) {
        clearWatchdog();
        await v.stop();
      }
    },

    async cancel() {
      const v = load();
      if (!v) {
        return;
      }
      cancelled = true;
      detach(v);
      try {
        await v.cancel();
      } catch {
        // already stopped
      }
    },
  };
}

// ------------------------------------------------------------- synthesizer ---

const SPEAK_MIN_TIMEOUT_MS = 8000;
const SPEAK_PER_CHAR_MS = 130;

export function createNativeSynthesizer(
  load: Loader<any> = loadTts,
): SpeechSynthesizerPort {
  let ready: Promise<boolean> | null = null;
  let current: {
    resolve: (r: SpeakResult) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  const settle = (result: SpeakResult) => {
    if (current) {
      const c = current;
      current = null;
      clearTimeout(c.timer);
      c.resolve(result);
    }
  };

  const init = (): Promise<boolean> => {
    if (!ready) {
      ready = (async () => {
        const tts = load();
        if (!tts) {
          return false;
        }
        try {
          await tts.getInitStatus();
          tts.addEventListener?.('tts-finish', () => settle('done'));
          tts.addEventListener?.('tts-cancel', () => settle('cancelled'));
          tts.addEventListener?.('tts-error', () => settle('error'));
          // Lower other audio (navigation prompts, music) while Orbit speaks.
          tts.setDucking?.(true);
          if (Platform.OS === 'ios') {
            tts.setIgnoreSilentSwitch?.('ignore');
          }
          tts.setDefaultRate?.(0.5);
          return true;
        } catch {
          // No speech engine installed (Android) or it failed to start.
          return false;
        }
      })();
    }
    return ready;
  };

  return {
    isAvailable: () => init(),

    async speak(text, options) {
      const tts = load();
      if (!tts || !(await init())) {
        return 'error';
      }
      settle('cancelled'); // never two at once
      try {
        await tts.setDefaultLanguage(options.locale);
      } catch {
        // That voice is not installed. Speaking would use the wrong language.
        return 'error';
      }
      if (options.rate !== undefined) {
        tts.setDefaultRate?.(options.rate);
      }
      return new Promise<SpeakResult>(resolve => {
        // If the engine never reports back, do not hold the queue forever.
        const timer = setTimeout(
          () => settle('error'),
          Math.max(SPEAK_MIN_TIMEOUT_MS, text.length * SPEAK_PER_CHAR_MS),
        );
        current = {resolve, timer};
        try {
          tts.speak(text);
        } catch {
          settle('error');
        }
      });
    },

    async stop() {
      const tts = load();
      settle('cancelled');
      try {
        await tts?.stop?.();
      } catch {
        // nothing was speaking
      }
    },
  };
}

// ------------------------------------------------------------- permissions ---

export function createPermissions(): PermissionPort {
  const fromResult = (r: string): PermissionState =>
    r === PermissionsAndroid.RESULTS.GRANTED
      ? 'granted'
      : r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
      ? 'blocked'
      : 'denied';

  return {
    async microphone() {
      if (Platform.OS !== 'android') {
        // iOS has no way to ask without starting recognition, which asks the OS itself.
        return 'unknown';
      }
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      return granted ? 'granted' : 'unknown';
    },

    async requestMicrophone() {
      if (Platform.OS !== 'android') {
        // Proceed: the first listen shows the system prompts for the microphone and for
        // speech recognition. A refusal comes back as a recognizer 'permission' error.
        return 'granted';
      }
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone for Orbit Assist',
          message:
            'Orbit Assist uses the microphone only while you tap to talk, to turn what you say into text.',
          buttonPositive: 'Allow',
          buttonNegative: 'Not now',
        },
      );
      return fromResult(result);
    },

    openSettings() {
      Linking.openSettings().catch(() => undefined);
    },
  };
}

// ------------------------------------------------------------ audio session ---

/**
 * Ducking is switched on in the synthesizer (react-native-tts), which asks the OS
 * to lower other audio while Orbit speaks and restore it afterwards. This port is
 * where finer control (explicit AVAudioSession categories, handling a navigation
 * app's prompts) would be added with a native module; it is deliberately a no-op
 * until then rather than pretending to manage more than it does.
 */
export const defaultAudioSession: AudioSessionPort = {
  beginSpeaking() {},
  endSpeaking() {},
};

/** Voice for this build, or null when neither speech library is present. */
export function createNativeVoice(): VoiceDeps | null {
  if (!loadVoice() && !loadTts()) {
    return null;
  }
  return {
    recognizer: createNativeRecognizer(),
    synthesizer: createNativeSynthesizer(),
    permissions: createPermissions(),
    audio: defaultAudioSession,
  };
}
