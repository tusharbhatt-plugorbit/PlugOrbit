import type {IconName} from '../ui/iconData';

/**
 * Vocabulary shared by every part of Orbit Assist. The wire types mirror
 * Backend/app/ai/schemas.py (protocol 1); keep the two in step.
 */

// ------------------------------------------------------------------- tools ---

export type ToolStatus = 'ok' | 'unavailable' | 'unknown' | 'error';

/** Where a tool answered from, so the model (and the card) can say how far to trust it. */
export type ToolSource = {
  system: string;
  kind:
    | 'deterministic_engine'
    | 'device_store'
    | 'device_gps'
    | 'sample_data'
    | 'unavailable';
  as_of?: number;
  demo: boolean;
  trust?: 'live' | 'estimated' | 'user' | 'unknown';
};

/** What a device tool returns. `unavailable` and `unknown` are answers, not failures. */
export type ToolEnvelope = {
  status: ToolStatus;
  data?: Record<string, unknown> | unknown[];
  message?: string;
  source?: ToolSource;
  assumptions?: string[];
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultPayload = ToolEnvelope & {tool_use_id: string};

// ------------------------------------------------------------------ actions ---

export type ActionKind =
  | 'view_route'
  | 'compare_chargers'
  | 'view_charger'
  | 'start_journey'
  | 'switch_charger'
  | 'start_navigation'
  | 'open_charging_screen'
  | 'save_preference';

/**
 * suggested          opens a screen when tapped
 * pending_approval   changes something; waits for an explicit yes
 * completed / failed / unavailable   set by the app after it tried, never by the model
 */
export type ActionStatus =
  | 'suggested'
  | 'pending_approval'
  | 'completed'
  | 'failed'
  | 'unavailable';

export type AssistantAction = {
  id: string;
  kind: ActionKind;
  label: string;
  detail?: string | null;
  params: Record<string, unknown>;
  status: ActionStatus;
  /** What happened when it was tried (shown on the card). */
  result?: string;
};

// ------------------------------------------------------------------- stream ---

export type UsageInfo = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  model_calls: number;
  estimated_cost_usd: number;
};

export type SourceInfo = {
  tool: string;
  system?: string | null;
  kind?: string | null;
  as_of?: number | null;
  demo: boolean;
  trust?: string | null;
  status: ToolStatus;
};

export type StreamEvent =
  | {type: 'session'; session_id: string; turn_id: string; resumed: boolean}
  | {type: 'text'; delta: string}
  | {type: 'memory'; patch: Record<string, unknown>}
  | {type: 'tool_requests'; turn_id: string; calls: ToolCall[]}
  | {type: 'actions'; actions: AssistantAction[]}
  | {
      type: 'done';
      outcome: string;
      usage: UsageInfo;
      sources: SourceInfo[];
    }
  | {type: 'error'; code: string; message: string; retryable: boolean};

// --------------------------------------------------------------- conversation ---

export type VoiceLanguage = 'auto' | 'en' | 'hi' | 'hinglish';
export type ResponseStyle = 'brief' | 'detailed';

/** idle -> listening -> thinking -> speaking -> idle; `error` until the next try. */
export type AssistantPhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export type MessageRole = 'user' | 'assistant' | 'notice';

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  at: number;
  via: 'voice' | 'text' | 'proactive' | 'system';
  /** The assistant is still writing this one. */
  streaming?: boolean;
  /** Cut short by the driver or by a failure. */
  interrupted?: boolean;
  actions?: AssistantAction[];
  sources?: SourceInfo[];
  /** A quiet one-line reason, e.g. why the AI could not answer. */
  error?: string;
  /** Proactive notices carry how much they matter. */
  level?: 'info' | 'action' | 'important' | 'critical';
  /** Where to go instead when the AI can't answer: the map and manual planner always work. */
  fallbacks?: FallbackLink[];
  /** What kind of notice this is (proactive messages), for the model's recent-notices context. */
  kind?: string;
};

export type FallbackLink = {
  label: string;
  icon: IconName;
  route:
    | 'RoutePlanner'
    | 'Map'
    | 'SmartDrive'
    | 'SmartDriveStop'
    | 'Vehicles'
    | 'ManualSoc';
};

// ------------------------------------------------------------------ settings ---

export type AssistantSettings = {
  /** The driver agreed that questions and trip details go to the AI service. */
  aiConsentAt: number | null;
  voiceLanguage: VoiceLanguage;
  responseStyle: ResponseStyle;
  /** Never speak; show text only. */
  textOnly: boolean;
  /** Silence the voice for now, keep everything else. */
  muted: boolean;
  /** Speak Orbit's own notices (stop ahead, charger problem) aloud. */
  speakProactive: boolean;
  /** Minimal screen with a large microphone. */
  drivingMode: boolean;
  /** The driver agreed Orbit may remember preferences on this phone. */
  rememberPreferences: boolean;
};

export const DEFAULT_SETTINGS: AssistantSettings = {
  aiConsentAt: null,
  voiceLanguage: 'auto',
  responseStyle: 'brief',
  textOnly: false,
  muted: false,
  speakProactive: true,
  drivingMode: false,
  rememberPreferences: false,
};

/** What the driver told Orbit about the journey in progress. Stated, not verified. */
export type JourneyMemory = {
  destination?: string;
  origin?: string;
  min_arrival_soc_pct?: number;
  strategy?: 'fastest' | 'cheapest' | 'reliable';
  max_stops?: number;
  selected_station_id?: string;
  selected_station_name?: string;
  updated_at?: number;
};

export type PreferenceKey =
  | 'min_arrival_soc_pct'
  | 'strategy'
  | 'preferred_network'
  | 'min_charger_kw'
  | 'max_stops'
  | 'prioritise';

/** A lasting preference the driver asked Orbit to remember. Only kept with consent. */
export type RememberedPreference = {
  key: PreferenceKey;
  value: string;
  savedAt: number;
};

export type PermissionState =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable';
