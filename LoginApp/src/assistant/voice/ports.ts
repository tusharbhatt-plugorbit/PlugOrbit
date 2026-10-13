import type {PermissionState} from '../types';

/**
 * What Orbit Assist needs from a speech engine, kept small so the native
 * library behind it can be swapped (or replaced by a cloud/real-time service)
 * without touching the conversation logic. The adapters are in native.ts.
 */

export type RecognizerErrorCode =
  | 'permission' // microphone or speech-recognition permission refused
  | 'no_speech' // nothing was said
  | 'network' // the engine needs a connection and has none
  | 'busy' // another app holds the microphone or a call is in progress
  | 'unavailable' // this phone has no recognition service
  | 'unknown';

export type RecognizerEvents = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  /** 0-1 loudness, for the listening animation. */
  onLevel?: (level: number) => void;
  onError: (code: RecognizerErrorCode, message: string) => void;
  /** The engine stopped listening, whatever the reason. */
  onEnd: () => void;
};

export interface SpeechRecognizerPort {
  isAvailable(): Promise<boolean>;
  start(locale: string, events: RecognizerEvents): Promise<void>;
  /** Stop listening and deliver what was heard as a final result. */
  stop(): Promise<void>;
  /** Stop listening and throw the audio away. */
  cancel(): Promise<void>;
}

export type SpeakResult = 'done' | 'cancelled' | 'error';

export interface SpeechSynthesizerPort {
  isAvailable(): Promise<boolean>;
  /** Speak one utterance. Resolves when it ends, is stopped, or fails. */
  speak(
    text: string,
    options: {locale: string; rate?: number},
  ): Promise<SpeakResult>;
  /** Stop the current utterance at once. */
  stop(): Promise<void>;
}

export interface PermissionPort {
  microphone(): Promise<PermissionState>;
  /** Ask the OS. `blocked` means it will no longer show the prompt. */
  requestMicrophone(): Promise<PermissionState>;
  openSettings(): void;
}

/** Politeness towards other audio (navigation prompts, music, calls). */
export interface AudioSessionPort {
  /** Orbit is about to speak: lower other audio rather than talking over it. */
  beginSpeaking(): void;
  endSpeaking(): void;
}

export type VoiceDeps = {
  recognizer: SpeechRecognizerPort;
  synthesizer: SpeechSynthesizerPort;
  permissions: PermissionPort;
  audio: AudioSessionPort;
};
