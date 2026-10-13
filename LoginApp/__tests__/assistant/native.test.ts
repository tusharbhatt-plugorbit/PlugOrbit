import { PermissionsAndroid, Platform } from 'react-native';
import {
  RECOGNIZER_WATCHDOG_MS,
  createNativeRecognizer,
  createNativeSynthesizer,
  createPermissions,
  mapRecognizerError,
} from '../../src/assistant/voice/native';

describe('mapRecognizerError', () => {
  it.each([
    [{ code: '7', message: '7/No match' }, 'no_speech'],
    [{ message: '6/No speech input' }, 'no_speech'],
    [{ message: '9/Insufficient permissions' }, 'permission'],
    [{ message: '2/Network error' }, 'network'],
    [{ message: '1/Network timeout' }, 'network'],
    [{ message: '8/RecognitionService busy' }, 'busy'],
    [{ message: '3/Audio error' }, 'busy'],
    [{ message: '12/Language not supported' }, 'unavailable'],
    [{ code: '1110', message: 'No speech detected' }, 'no_speech'],
    [{ message: 'Speech recognition permission denied' }, 'permission'],
    [{ message: 'Siri and Dictation are disabled' }, 'unavailable'],
    [{ message: 'The network connection was lost' }, 'network'],
    [{ message: 'weird' }, 'unknown'],
    [undefined, 'unknown'],
  ])('%j -> %s', (raw, expected) => {
    expect(mapRecognizerError(raw as any)).toBe(expected);
  });
});

function fakeVoiceModule(over: Record<string, any> = {}) {
  const m: any = {
    started: [] as string[],
    stops: 0,
    cancels: 0,
    isAvailable: jest.fn(async () => 1),
    start: jest.fn(async (l: string) => {
      m.started.push(l);
    }),
    stop: jest.fn(async () => {
      m.stops++;
    }),
    cancel: jest.fn(async () => {
      m.cancels++;
    }),
    removeAllListeners: jest.fn(),
    ...over,
  };
  return m;
}

const events = () => ({
  onPartial: jest.fn(),
  onFinal: jest.fn(),
  onLevel: jest.fn(),
  onError: jest.fn(),
  onEnd: jest.fn(),
});

describe('native recognizer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is unavailable when the module is missing or says no', async () => {
    expect(await createNativeRecognizer(() => null).isAvailable()).toBe(false);
    expect(
      await createNativeRecognizer(() =>
        fakeVoiceModule({ isAvailable: async () => 0 }),
      ).isAvailable(),
    ).toBe(false);
    expect(
      await createNativeRecognizer(() =>
        fakeVoiceModule({
          isAvailable: async () => {
            throw new Error('x');
          },
        }),
      ).isAvailable(),
    ).toBe(false);
    expect(
      await createNativeRecognizer(() => fakeVoiceModule()).isAvailable(),
    ).toBe(true);
  });

  it('passes the language and relays partial, volume, final and end', async () => {
    const mod = fakeVoiceModule();
    const r = createNativeRecognizer(() => mod);
    const ev = events();
    await r.start('hi-IN', ev);
    expect(mod.started).toEqual(['hi-IN']);
    mod.onSpeechStart();
    mod.onSpeechPartialResults({ value: ['jaipur'] });
    mod.onSpeechVolumeChanged({ value: 4 });
    mod.onSpeechResults({ value: ['jaipur jaana hai', 'other'] });
    mod.onSpeechEnd();
    expect(ev.onPartial).toHaveBeenCalledWith('jaipur');
    expect(ev.onLevel).toHaveBeenCalledWith(0.5);
    expect(ev.onFinal).toHaveBeenCalledWith('jaipur jaana hai');
    expect(ev.onEnd).toHaveBeenCalled();
  });

  it('maps engine errors', async () => {
    const mod = fakeVoiceModule();
    const ev = events();
    await createNativeRecognizer(() => mod).start('en-IN', ev);
    mod.onSpeechError({
      error: { code: '9', message: '9/Insufficient permissions' },
    });
    expect(ev.onError).toHaveBeenCalledWith(
      'permission',
      '9/Insufficient permissions',
    );
  });

  it('reports a start() that throws', async () => {
    const mod = fakeVoiceModule({
      start: async () => {
        throw Object.assign(new Error('Speech recognition permission denied'), {
          code: 'x',
        });
      },
    });
    const ev = events();
    await createNativeRecognizer(() => mod).start('en-IN', ev);
    expect(ev.onError).toHaveBeenCalledWith('permission', expect.any(String));
  });

  it('reports a missing module instead of crashing', async () => {
    const ev = events();
    await createNativeRecognizer(() => null).start('en-IN', ev);
    expect(ev.onError).toHaveBeenCalledWith('unavailable', expect.any(String));
  });

  it('gives up on an engine that never answers', async () => {
    const mod = fakeVoiceModule();
    const ev = events();
    await createNativeRecognizer(() => mod).start('en-IN', ev);
    jest.advanceTimersByTime(RECOGNIZER_WATCHDOG_MS + 1);
    expect(ev.onError).toHaveBeenCalledWith('unavailable', expect.any(String));
    expect(mod.cancels).toBe(1);
  });

  it('does not trip the watchdog once the engine has started', async () => {
    const mod = fakeVoiceModule();
    const ev = events();
    await createNativeRecognizer(() => mod).start('en-IN', ev);
    mod.onSpeechStart();
    jest.advanceTimersByTime(RECOGNIZER_WATCHDOG_MS * 2);
    expect(ev.onError).not.toHaveBeenCalled();
  });

  it('ignores events after a cancel', async () => {
    const mod = fakeVoiceModule();
    const r = createNativeRecognizer(() => mod);
    const ev = events();
    await r.start('en-IN', ev);
    mod.onSpeechStart();
    await r.cancel();
    mod.onSpeechResults({ value: ['late'] });
    expect(ev.onFinal).not.toHaveBeenCalled();
    expect(mod.cancels).toBe(1);
  });
});

function fakeTtsModule(over: Record<string, any> = {}) {
  const handlers: Record<string, () => void> = {};
  const m: any = {
    handlers,
    spoken: [] as string[],
    languages: [] as string[],
    getInitStatus: jest.fn(async () => 'success'),
    addEventListener: (name: string, fn: () => void) => {
      handlers[name] = fn;
    },
    setDucking: jest.fn(),
    setIgnoreSilentSwitch: jest.fn(),
    setDefaultRate: jest.fn(),
    setDefaultLanguage: jest.fn(async (l: string) => {
      m.languages.push(l);
    }),
    speak: jest.fn((t: string) => {
      m.spoken.push(t);
    }),
    stop: jest.fn(async () => {
      handlers['tts-cancel']?.();
    }),
    ...over,
  };
  return m;
}

async function settleNativeSetup() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

describe('native synthesizer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('handles a rejected native speak promise immediately', async () => {
    const mod = fakeTtsModule({
      speak: () => Promise.reject(new Error('audio unavailable')),
    });
    const result = createNativeSynthesizer(() => mod).speak('Hello.', {
      locale: 'en-IN',
    });
    await settleNativeSetup();
    expect(await result).toBe('error');
  });

  it('does not speak after stop while the language is still being prepared', async () => {
    let ready!: () => void;
    const mod = fakeTtsModule({
      setDefaultLanguage: () =>
        new Promise<void>(resolve => {
          ready = resolve;
        }),
    });
    const synth = createNativeSynthesizer(() => mod);
    const result = synth.speak('Old response.', { locale: 'en-IN' });
    await settleNativeSetup();
    await synth.stop();
    ready();
    expect(await result).toBe('cancelled');
    expect(mod.spoken).toEqual([]);
  });

  it('is unavailable when the module or its engine is missing', async () => {
    expect(await createNativeSynthesizer(() => null).isAvailable()).toBe(false);
    expect(
      await createNativeSynthesizer(() =>
        fakeTtsModule({
          getInitStatus: async () => {
            throw { code: 'no_engine' };
          },
        }),
      ).isAvailable(),
    ).toBe(false);
  });

  it('turns on ducking and speaks in the requested language until the engine finishes', async () => {
    const mod = fakeTtsModule();
    const s = createNativeSynthesizer(() => mod);
    const result = s.speak('Hello there.', { locale: 'en-IN' });
    await settleNativeSetup();
    expect(mod.setDucking).toHaveBeenCalledWith(true);
    expect(mod.languages).toEqual(['en-IN']);
    expect(mod.spoken).toEqual(['Hello there.']);
    mod.handlers['tts-finish']();
    expect(await result).toBe('done');
  });

  it('reports a cancel and an engine error', async () => {
    const mod = fakeTtsModule();
    const s = createNativeSynthesizer(() => mod);
    const a = s.speak('One.', { locale: 'en-IN' });
    await settleNativeSetup();
    await s.stop();
    expect(await a).toBe('cancelled');
    const b = s.speak('Two.', { locale: 'en-IN' });
    await settleNativeSetup();
    mod.handlers['tts-error']();
    expect(await b).toBe('error');
  });

  it('declines when that language’s voice is not installed rather than speaking it wrongly', async () => {
    const mod = fakeTtsModule({
      setDefaultLanguage: async () => {
        throw new Error('no voice');
      },
    });
    expect(
      await createNativeSynthesizer(() => mod).speak('नमस्ते', {
        locale: 'hi-IN',
      }),
    ).toBe('error');
    expect(mod.spoken).toEqual([]);
  });

  it('does not hold the queue forever if the engine never reports back', async () => {
    const mod = fakeTtsModule();
    const result = createNativeSynthesizer(() => mod).speak('Stuck.', {
      locale: 'en-IN',
    });
    await settleNativeSetup();
    jest.advanceTimersByTime(9000);
    expect(await result).toBe('error');
  });
});

describe('permissions', () => {
  const original = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => original });
    jest.restoreAllMocks();
  });
  const os = (name: string) =>
    Object.defineProperty(Platform, 'OS', {
      get: () => name,
      configurable: true,
    });

  it('asks Android for the microphone and tells blocked from denied', async () => {
    os('android');
    const p = createPermissions();
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    expect(await p.microphone()).toBe('unknown');
    const req = jest.spyOn(PermissionsAndroid, 'request');
    req.mockResolvedValueOnce('granted' as any);
    expect(await p.requestMicrophone()).toBe('granted');
    req.mockResolvedValueOnce('denied' as any);
    expect(await p.requestMicrophone()).toBe('denied');
    req.mockResolvedValueOnce('never_ask_again' as any);
    expect(await p.requestMicrophone()).toBe('blocked');
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    expect(await p.microphone()).toBe('granted');
  });

  it('lets iOS ask on first use, since it has no way to ask earlier', async () => {
    os('ios');
    const p = createPermissions();
    expect(await p.microphone()).toBe('unknown');
    expect(await p.requestMicrophone()).toBe('granted');
  });
});
