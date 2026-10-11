import {createStore, persist, useStore} from '../store/createStore';
import type {Persisted} from '../store/createStore';
import {getStorage} from '../store/storage';
import {
  AssistantPhase,
  AssistantSettings,
  ChatMessage,
  DEFAULT_SETTINGS,
  JourneyMemory,
  PermissionState,
  PreferenceKey,
  RememberedPreference,
} from './types';

/**
 * Orbit Assist keeps its own small store, separate from the app store, so none
 * of its data rides along with cloud backup or changes a persisted contract.
 *
 * Persisted on this phone: settings, the journey memory, remembered preferences
 * (only with consent) and the proactive-notice dedupe record.
 * Never persisted: the transcript, partial speech and anything audio. Raw
 * microphone audio is never stored by the app at all.
 */

export type GatewayHealth =
  | 'unknown'
  | 'ready'
  | 'unavailable'
  | 'signed_out'
  | 'offline';

export type AssistantState = {
  hydrated: boolean;
  settings: AssistantSettings;
  journey: JourneyMemory | null;
  preferences: RememberedPreference[];
  /** dedupeKey -> epoch ms it last fired, so a notice is not repeated. */
  proactiveSeen: Record<string, number>;

  // --- session only ---
  messages: ChatMessage[];
  phase: AssistantPhase;
  /** Words recognised so far in the current utterance. */
  partial: string;
  sessionId: string | null;
  microphone: PermissionState;
  recognizerAvailable: boolean;
  synthAvailable: boolean;
  gateway: {
    health: GatewayHealth;
    reason: string | null;
    checkedAt: number | null;
  };
  sheetOpen: boolean;
  /** The message currently being read aloud (for replay highlighting). */
  speakingId: string | null;
  /** Level 0-1 of the speech being heard, for the listening animation. */
  level: number;
};

export const INITIAL_ASSISTANT: AssistantState = {
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  journey: null,
  preferences: [],
  proactiveSeen: {},
  messages: [],
  phase: 'idle',
  partial: '',
  sessionId: null,
  microphone: 'unknown',
  recognizerAvailable: true,
  synthAvailable: true,
  gateway: {health: 'unknown', reason: null, checkedAt: null},
  sheetOpen: false,
  speakingId: null,
  level: 0,
};

export const assistantStore = createStore<AssistantState>(INITIAL_ASSISTANT);

export const ASSISTANT_STORE_KEY = 'plugorbit/assistant';
const PERSISTED: ReadonlyArray<keyof AssistantState> = [
  'settings',
  'journey',
  'preferences',
  'proactiveSeen',
];
let persisted: Persisted | null = null;

/** A journey that has not been mentioned for this long is forgotten. */
export const JOURNEY_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PROACTIVE_SEEN = 40;

export async function hydrateAssistantStore(): Promise<void> {
  if (!persisted) {
    persisted = persist(assistantStore, {
      key: ASSISTANT_STORE_KEY,
      version: 1,
      storage: getStorage(),
      pick: PERSISTED,
    });
  }
  await persisted.hydrated;
  // Fields added after an install keep their defaults.
  assistantStore.set(s => ({
    hydrated: true,
    settings: {...DEFAULT_SETTINGS, ...s.settings},
  }));
}

export function flushAssistantStore(): Promise<void> {
  return persisted ? persisted.flush() : Promise.resolve();
}

/** Test helper: a clean slate without touching storage. */
export function resetAssistantStore(patch: Partial<AssistantState> = {}): void {
  persisted?.stop();
  persisted = null;
  assistantStore.replace({...INITIAL_ASSISTANT, ...patch});
}

export function useAssistantState<S>(selector: (s: AssistantState) => S): S {
  return useStore(assistantStore, selector);
}

// ---------------------------------------------------------------- settings ---

export function updateSettings(patch: Partial<AssistantSettings>): void {
  assistantStore.set(s => ({settings: {...s.settings, ...patch}}));
}

export const hasAiConsent = (s: AssistantState = assistantStore.get()) =>
  s.settings.aiConsentAt !== null;

// ----------------------------------------------------------------- journey ---

export function patchJourney(
  patch: Partial<JourneyMemory>,
  now = Date.now(),
): void {
  assistantStore.set(s => {
    const next: JourneyMemory = {...(s.journey ?? {}), updated_at: now};
    (Object.keys(patch) as Array<keyof JourneyMemory>).forEach(k => {
      const v = patch[k];
      if (v !== undefined && v !== null) {
        (next as Record<string, unknown>)[k] = v;
      }
    });
    // A new destination invalidates a charger picked for the old one.
    if (patch.destination && patch.destination !== s.journey?.destination) {
      delete next.selected_station_id;
      delete next.selected_station_name;
      if (patch.selected_station_id) {
        next.selected_station_id = patch.selected_station_id;
      }
      if (patch.selected_station_name) {
        next.selected_station_name = patch.selected_station_name;
      }
    }
    return {journey: next};
  });
}

export function clearJourney(): void {
  assistantStore.set({journey: null});
}

/** The journey memory if it is still fresh, else null. */
export function freshJourney(
  state: AssistantState = assistantStore.get(),
  now = Date.now(),
): JourneyMemory | null {
  const j = state.journey;
  if (!j || !j.updated_at || now - j.updated_at > JOURNEY_MEMORY_TTL_MS) {
    return null;
  }
  return j;
}

// ------------------------------------------------------------- preferences ---

export function savePreference(
  key: PreferenceKey,
  value: string,
  now = Date.now(),
): boolean {
  if (!assistantStore.get().settings.rememberPreferences) {
    return false;
  }
  assistantStore.set(s => ({
    preferences: [
      ...s.preferences.filter(p => p.key !== key),
      {key, value, savedAt: now},
    ],
  }));
  return true;
}

export function removePreference(key: PreferenceKey): void {
  assistantStore.set(s => ({
    preferences: s.preferences.filter(p => p.key !== key),
  }));
}

/** Forget every saved preference; consent stays as the driver set it. */
export function clearPreferences(): void {
  assistantStore.set({preferences: []});
}

/** Preferences Orbit may use right now: only while the driver allows remembering. */
export function activePreferences(
  state: AssistantState = assistantStore.get(),
): RememberedPreference[] {
  return state.settings.rememberPreferences ? state.preferences : [];
}

// --------------------------------------------------------------- proactive ---

export function markProactive(key: string, now = Date.now()): void {
  assistantStore.set(s => {
    const entries = Object.entries({...s.proactiveSeen, [key]: now})
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PROACTIVE_SEEN);
    return {proactiveSeen: Object.fromEntries(entries)};
  });
}

// ------------------------------------------------------------ conversation ---

export function clearConversationState(): void {
  assistantStore.set({
    messages: [],
    sessionId: null,
    partial: '',
    phase: 'idle',
    speakingId: null,
    level: 0,
  });
}

/** Everything Orbit Assist keeps on this phone, except the AI consent record. */
export function eraseAssistantData(): void {
  clearConversationState();
  assistantStore.set({journey: null, preferences: [], proactiveSeen: {}});
}
