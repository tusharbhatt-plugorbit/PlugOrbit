import type { Store } from '../store/createStore';
import { ActionOutcome } from './actions';
import { Gateway, GatewayError, TurnBody } from './gateway';
import {
  AssistantState,
  assistantStore,
  activePreferences,
  clearConversationState,
  clearJourney,
  freshJourney,
  hasAiConsent,
  patchJourney,
  updateSettings,
} from './store';
import { SentenceSplitter } from './voice/sentences';
import { Endpointer } from './voice/endpointing';
import { SpeechPipeline } from './voice/pipeline';
import type { RecognizerErrorCode, VoiceDeps } from './voice/ports';
import type {
  AssistantAction,
  AssistantPhase,
  ChatMessage,
  FallbackLink,
  JourneyMemory,
  StreamEvent,
  ToolCall,
  ToolEnvelope,
} from './types';

export type ControllerDeps = {
  gateway: Gateway;
  runTool: (call: ToolCall) => Promise<ToolEnvelope>;
  performAction: (
    action: AssistantAction,
    options: { consent?: boolean },
  ) => Promise<ActionOutcome>;
  /** Null when the speech modules are not part of this build: text only. */
  voice: VoiceDeps | null;
  store?: Store<AssistantState>;
  now?: () => number;
  demo?: boolean;
  /** Hook for tests/timing. */
  silenceMs?: number;
};

const MAX_ROUNDS = 8;
/** The gateway rejects longer messages; a long utterance is cut rather than lost. */
const MAX_MESSAGE_CHARS = 1200;
const RECENT_NOTICE_WINDOW_MS = 30 * 60 * 1000;
const QUEUED_SPEECH_MAX_AGE_MS = 2 * 60 * 1000;

const FALLBACK_PLANNER: FallbackLink = {
  label: 'Plan a route',
  icon: 'route',
  route: 'RoutePlanner',
};
const FALLBACK_MAP: FallbackLink = {
  label: 'Open the map',
  icon: 'map',
  route: 'Map',
};

/** One short, honest line for each way the AI service can be out of reach. */
export function describeGatewayError(e: unknown): {
  text: string;
  health?: 'signed_out' | 'unavailable' | 'offline';
  fallbacks: FallbackLink[];
} {
  if (e instanceof GatewayError) {
    switch (e.code) {
      case 'NO_SESSION':
        return {
          text: 'Orbit’s AI needs you signed in to your PlugOrbit account. The map and trip planner still work.',
          health: 'signed_out',
          fallbacks: [FALLBACK_PLANNER, FALLBACK_MAP],
        };
      case 'OFFLINE':
        return {
          text: 'I can’t reach the assistant. You may be offline or have a weak signal. The map and planner still work with saved data.',
          health: 'offline',
          fallbacks: [FALLBACK_PLANNER, FALLBACK_MAP],
        };
      case 'TIMEOUT':
        return {
          text: 'That took too long. Try again, or use the planner meanwhile.',
          fallbacks: [FALLBACK_PLANNER],
        };
      case 'UNAVAILABLE':
        return {
          text: 'The AI assistant isn’t available right now. The map and trip planner still work.',
          health: 'unavailable',
          fallbacks: [FALLBACK_PLANNER, FALLBACK_MAP],
        };
      case 'RATE_LIMITED':
        return {
          text: `You’re asking faster than I can answer. Try again in ${
            e.retryAfter ?? 'a few'
          } seconds.`,
          fallbacks: [],
        };
      case 'DAILY_LIMIT':
        return {
          text: 'You’ve reached today’s Orbit Assist limit. It resets tomorrow. The planner still works.',
          fallbacks: [FALLBACK_PLANNER],
        };
      case 'BUSY':
        return {
          text: 'I’m still working on your last question.',
          fallbacks: [],
        };
      default:
        return {
          text: 'The assistant had a problem. Try again, or use the planner meanwhile.',
          fallbacks: [FALLBACK_PLANNER],
        };
    }
  }
  return {
    text: 'Something went wrong. Try again.',
    fallbacks: [FALLBACK_PLANNER],
  };
}

const RECOGNIZER_LOCALE = {
  auto: 'en-IN',
  en: 'en-IN',
  hi: 'hi-IN',
  hinglish: 'hi-IN',
} as const;

export class AssistantController {
  private readonly store: Store<AssistantState>;
  private readonly now: () => number;
  private readonly pipeline: SpeechPipeline | null;
  private readonly splitter = new SentenceSplitter();
  private readonly endpointer: Endpointer;
  private abort: AbortController | null = null;
  /** Bumped to invalidate everything an in-flight turn does. */
  private turn = 0;
  private listen = 0;
  private starting = false;
  private foreground = true;
  private seq = 0;
  private running = new Set<string>();
  private queuedSpeech: Array<{ text: string; id: string; at: number }> = [];

  constructor(private readonly deps: ControllerDeps) {
    this.store = deps.store ?? assistantStore;
    this.now = deps.now ?? Date.now;
    this.endpointer = new Endpointer(() => {
      this.stopListening();
    }, deps.silenceMs ?? 1400);
    this.pipeline = deps.voice
      ? new SpeechPipeline(deps.voice.synthesizer, deps.voice.audio, {
          onSpeaking: (id, speaking) => this.onSpeaking(id, speaking),
        })
      : null;
  }

  // ------------------------------------------------------------------ state ---

  private get s(): AssistantState {
    return this.store.get();
  }

  private set(patch: Partial<AssistantState>): void {
    this.store.set(patch);
  }

  private setPhase(phase: AssistantPhase): void {
    if (this.s.phase !== phase) {
      this.set({ phase });
    }
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.now().toString(36)}-${this.seq}`;
  }

  private push(
    msg: Omit<ChatMessage, 'id' | 'at'> & { id?: string },
  ): ChatMessage {
    const full: ChatMessage = { id: this.id('m'), at: this.now(), ...msg };
    this.set({ messages: [...this.s.messages, full] });
    return full;
  }

  private update(
    id: string,
    patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>),
  ): void {
    this.set({
      messages: this.s.messages.map(m =>
        m.id === id
          ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) }
          : m,
      ),
    });
  }

  getState(): AssistantState {
    return this.s;
  }

  /** In flight: a question is being answered. */
  get busy(): boolean {
    return this.abort !== null;
  }

  // ----------------------------------------------------------------- health ---

  async refreshGateway(): Promise<void> {
    try {
      const status = await this.deps.gateway.status();
      this.set({
        gateway: {
          health: status.enabled ? 'ready' : 'unavailable',
          reason: status.enabled ? null : status.reason ?? null,
          checkedAt: this.now(),
        },
      });
    } catch (e) {
      const d = describeGatewayError(e);
      this.set({
        gateway: {
          health: d.health ?? 'unavailable',
          reason: d.text,
          checkedAt: this.now(),
        },
      });
    }
  }

  async refreshVoice(): Promise<void> {
    const v = this.deps.voice;
    if (!v) {
      this.set({
        recognizerAvailable: false,
        synthAvailable: false,
        microphone: 'unavailable',
      });
      return;
    }
    const [rec, syn, mic] = await Promise.all([
      v.recognizer.isAvailable().catch(() => false),
      v.synthesizer.isAvailable().catch(() => false),
      v.permissions.microphone().catch(() => 'unknown' as const),
    ]);
    this.set({
      recognizerAvailable: rec,
      synthAvailable: syn,
      microphone: rec ? mic : 'unavailable',
    });
  }

  grantConsent(): void {
    updateSettings({ aiConsentAt: this.now() });
  }

  // ---------------------------------------------------------------- context ---

  private context(via: 'voice' | 'text') {
    const st = this.s;
    const now = this.now();
    const j: JourneyMemory | null = freshJourney(st, now);
    const recent = st.messages
      .filter(m => m.role === 'notice' && now - m.at < RECENT_NOTICE_WINDOW_MS)
      .slice(-3)
      .map(m => ({
        at: m.at,
        kind: (m.kind ?? 'notice').slice(0, 40),
        text: m.text.slice(0, 300),
      }));
    return {
      locale: 'en-IN',
      voice_language: st.settings.voiceLanguage,
      response_style: st.settings.responseStyle,
      input_mode: via,
      driving_mode: st.settings.drivingMode,
      local_time: localIso(new Date(now)),
      demo_data: this.deps.demo ?? true,
      ...(j ? { journey: clampJourney(j) } : {}),
      remembered_preferences: activePreferences(st)
        .slice(0, 12)
        .map(p => ({
          key: p.key,
          value: p.value.slice(0, 80),
          saved_at: p.savedAt,
        })),
      recent_events: recent,
    };
  }

  // ------------------------------------------------------------------ speak ---

  private shouldSpeak(via: 'voice' | 'text' | 'proactive'): boolean {
    const st = this.s;
    if (
      !this.pipeline ||
      !st.synthAvailable ||
      st.settings.textOnly ||
      st.settings.muted
    ) {
      return false;
    }
    if (via === 'proactive') {
      return st.settings.speakProactive;
    }
    return via === 'voice' || st.settings.drivingMode;
  }

  private onSpeaking(id: string | null, speaking: boolean): void {
    this.set({ speakingId: speaking ? id : null });
    if (speaking) {
      this.setPhase('speaking');
    } else if (!this.busy && this.s.phase !== 'listening') {
      this.setPhase('idle');
      this.flushQueuedSpeech();
    }
  }

  private flushQueuedSpeech(): void {
    const fresh = this.queuedSpeech.filter(
      q => this.now() - q.at < QUEUED_SPEECH_MAX_AGE_MS,
    );
    this.queuedSpeech = [];
    if (fresh.length > 0 && this.pipeline && this.shouldSpeak('proactive')) {
      // One at a time and only the most important lands first; older ones were queued earlier.
      fresh.forEach(q => this.pipeline!.enqueue(q.text, q.id));
    }
  }

  // ------------------------------------------------------------------- send ---

  /** Returns false when nothing was sent (empty text, or the driver has not agreed to AI use yet). */
  async send(text: string, via: 'voice' | 'text' = 'text'): Promise<boolean> {
    const clean = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!clean || !hasAiConsent(this.s)) {
      return false;
    }
    if (this.busy) {
      await this.interrupt();
    }
    await this.runTurn(clean, via);
    return true;
  }

  private async runTurn(
    text: string,
    via: 'voice' | 'text',
    attempt = 0,
  ): Promise<void> {
    const mine = ++this.turn;
    const abort = new AbortController();
    this.abort = abort;
    this.splitter.reset();
    this.set({ partial: '' });
    this.setPhase('thinking');

    if (attempt === 0) {
      this.push({ role: 'user', text, via });
    }
    const reply = this.push({
      role: 'assistant',
      text: '',
      via,
      streaming: true,
    });
    const speak = this.shouldSpeak(via);
    const alive = () => mine === this.turn;

    let body: TurnBody = {
      session_id: this.s.sessionId ?? undefined,
      message: text,
      context: this.context(via),
    };
    let streamError: Extract<StreamEvent, { type: 'error' }> | null = null;

    const onEvent = (
      ev: StreamEvent,
      state: { calls: ToolCall[] | null; turnId: string | null },
    ) => {
      if (!alive()) {
        return;
      }
      switch (ev.type) {
        case 'session':
          this.set({ sessionId: ev.session_id });
          state.turnId = ev.turn_id;
          break;
        case 'text':
          this.update(reply.id, m => ({ text: m.text + ev.delta }));
          if (speak) {
            this.splitter
              .push(ev.delta)
              .forEach(sentence => this.pipeline!.enqueue(sentence, reply.id));
          }
          break;
        case 'memory':
          applyMemoryPatch(ev.patch);
          break;
        case 'tool_requests':
          state.calls = ev.calls;
          state.turnId = ev.turn_id;
          break;
        case 'actions':
          this.update(reply.id, { actions: ev.actions });
          break;
        case 'done':
          this.update(reply.id, { sources: ev.sources });
          break;
        case 'error':
          streamError = ev;
          break;
      }
    };

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const state: { calls: ToolCall[] | null; turnId: string | null } = {
          calls: null,
          turnId: null,
        };
        await this.deps.gateway.streamTurn(body, ev => onEvent(ev, state), {
          signal: abort.signal,
        });
        if (!alive() || streamError || !state.calls) {
          break;
        }
        const calls = state.calls;
        const results = await Promise.all(
          calls.map(async call => ({
            tool_use_id: call.id,
            ...(await this.deps.runTool(call)),
          })),
        );
        if (!alive()) {
          return;
        }
        body = {
          session_id: this.s.sessionId ?? undefined,
          turn_id: state.turnId ?? undefined,
          tool_results: results,
        };
      }
      if (!alive()) {
        return;
      }
      if (speak) {
        this.splitter
          .flush()
          .forEach(sentence => this.pipeline!.enqueue(sentence, reply.id));
      }
      if (streamError) {
        const err: Extract<StreamEvent, { type: 'error' }> = streamError;
        this.update(reply.id, m => ({
          streaming: false,
          interrupted: m.text.length > 0,
          error: err.message,
          ...(err.retryable
            ? { fallbacks: [FALLBACK_PLANNER, FALLBACK_MAP] }
            : {}),
        }));
      } else {
        this.update(reply.id, { streaming: false });
      }
    } catch (e) {
      if (!alive()) {
        return;
      }
      if (
        e instanceof GatewayError &&
        e.code === 'SESSION_LOST' &&
        attempt === 0
      ) {
        // The server forgot this conversation (restart, expiry). Start a fresh one with
        // the same question; the journey memory in the context carries what matters.
        this.set({ sessionId: null });
        this.update(reply.id, { streaming: false, text: '' });
        this.set({ messages: this.s.messages.filter(m => m.id !== reply.id) });
        this.abort = null;
        return this.runTurn(text, via, 1);
      }
      if (e instanceof GatewayError && e.code === 'CANCELLED') {
        return;
      }
      const d = describeGatewayError(e);
      if (d.health) {
        this.set({
          gateway: { health: d.health, reason: d.text, checkedAt: this.now() },
        });
      }
      this.update(reply.id, m => ({
        streaming: false,
        interrupted: m.text.length > 0,
        error: d.text,
        fallbacks: d.fallbacks,
      }));
    } finally {
      if (alive()) {
        this.abort = null;
        if (this.pipeline?.busy) {
          this.setPhase('speaking');
        } else {
          this.setPhase('idle');
          this.flushQueuedSpeech();
        }
      }
    }
  }

  // --------------------------------------------------------------- listening ---

  /** Tap to start; tap again (or pause) to send. */
  async toggleMic(): Promise<void> {
    if (this.s.phase === 'listening') {
      await this.stopListening();
    } else {
      await this.startListening();
    }
  }

  async startListening(): Promise<void> {
    // A second tap while the first is still asking for permission must not open a second session.
    if (this.starting) {
      return;
    }
    this.starting = true;
    try {
      await this.beginListening();
    } finally {
      this.starting = false;
    }
  }

  private async beginListening(): Promise<void> {
    const v = this.deps.voice;
    if (!hasAiConsent(this.s) || !this.foreground) {
      return;
    }
    if (!v || !this.s.recognizerAvailable) {
      this.notice(
        'Voice input isn’t available on this phone, so type your question instead.',
        { speak: false, kind: 'voice_unavailable' },
      );
      return;
    }
    // Starting to talk always wins over Orbit talking or thinking.
    if (this.busy || this.pipeline?.busy || this.s.phase === 'speaking') {
      await this.interrupt();
    }
    const permissionRequest = this.listen;
    let permission = await v.permissions
      .microphone()
      .catch(() => 'unknown' as const);
    if (
      permissionRequest !== this.listen ||
      !this.foreground ||
      !hasAiConsent(this.s)
    ) {
      return;
    }
    if (permission !== 'granted') {
      permission = await v.permissions
        .requestMicrophone()
        .catch(() => 'denied' as const);
    }
    if (
      permissionRequest !== this.listen ||
      !this.foreground ||
      !hasAiConsent(this.s)
    ) {
      return;
    }
    this.set({ microphone: permission });
    if (permission !== 'granted') {
      this.notice(
        permission === 'blocked'
          ? 'Microphone access is off for PlugOrbit. Turn it on in your phone’s settings to talk to Orbit. You can still type.'
          : 'Orbit needs the microphone to hear you. You can allow it, or type instead.',
        { speak: false, kind: 'mic_permission' },
      );
      return;
    }
    const id = ++this.listen;
    this.set({ partial: '', level: 0 });
    this.setPhase('listening');
    this.endpointer.start();
    const current = () => id === this.listen;
    try {
      await v.recognizer.start(
        RECOGNIZER_LOCALE[this.s.settings.voiceLanguage],
        {
          onPartial: text => {
            if (current()) {
              this.set({ partial: text });
              if (text.trim()) {
                this.endpointer.heardSpeech();
              }
            }
          },
          onFinal: text => {
            if (current()) {
              this.finishListening(text);
            }
          },
          onLevel: level => {
            if (current()) {
              this.set({ level });
            }
          },
          onError: (code, message) => {
            if (current()) {
              this.listenFailed(code, message);
            }
          },
          onEnd: () => {
            if (current() && this.s.phase === 'listening') {
              // The engine stopped without a final result: use what it heard.
              this.finishListening(this.s.partial);
            }
          },
        },
      );
    } catch (e) {
      if (current()) {
        this.listenFailed(
          'unknown',
          e instanceof Error ? e.message : 'unknown',
        );
      }
    }
  }

  /** Stop listening and send what was heard. */
  async stopListening(): Promise<void> {
    if (this.s.phase !== 'listening') {
      return;
    }
    this.endpointer.stop();
    const id = this.listen;
    try {
      await this.deps.voice?.recognizer.stop();
    } catch {
      // The engine already stopped; use what we have.
    }
    // Most engines deliver a final result from stop(); if none came, use the partial.
    if (id === this.listen && this.s.phase === 'listening') {
      this.finishListening(this.s.partial);
    }
  }

  private finishListening(text: string): void {
    this.listen += 1; // ignore any late events from this utterance
    this.endpointer.stop();
    const heard = text.trim();
    this.set({ partial: '', level: 0 });
    if (!heard) {
      this.setPhase('idle');
      return;
    }
    this.setPhase('thinking');
    this.send(heard, 'voice');
  }

  private listenFailed(code: RecognizerErrorCode, message: string): void {
    this.listen += 1;
    this.endpointer.stop();
    this.set({ partial: '', level: 0 });
    this.setPhase('idle');
    if (code === 'permission') {
      this.set({ microphone: 'denied' });
    }
    if (code === 'unavailable') {
      this.set({ recognizerAvailable: false });
    }
    const text =
      code === 'no_speech'
        ? 'I didn’t catch that. Tap the microphone and try again.'
        : code === 'permission'
        ? 'Orbit needs the microphone to hear you. You can allow it in settings, or type instead.'
        : code === 'network'
        ? 'Your phone’s speech recognition needs a connection right now. You can type instead.'
        : code === 'busy'
        ? 'The microphone is in use by another app or a call. Try again in a moment, or type.'
        : code === 'unavailable'
        ? 'This phone has no speech recognition service. Type your question instead.'
        : `I couldn’t listen just now.${message ? '' : ''} Try again, or type.`;
    this.notice(text, { speak: false, kind: `voice_${code}` });
  }

  // ----------------------------------------------------------- interruption ---

  /** Stop everything Orbit is doing: listening, thinking, speaking. */
  async interrupt(): Promise<void> {
    this.turn += 1;
    this.listen += 1;
    this.abort?.abort();
    this.abort = null;
    this.endpointer.stop();
    this.queuedSpeech = [];
    this.splitter.reset();
    const v = this.deps.voice;
    await Promise.all([
      v?.recognizer.cancel().catch(() => undefined),
      this.pipeline?.stop(),
    ]);
    this.set({
      messages: this.s.messages.map(m =>
        m.streaming
          ? { ...m, streaming: false, interrupted: m.text.length > 0 }
          : m,
      ),
      partial: '',
      level: 0,
      speakingId: null,
    });
    this.setPhase('idle');
  }

  /** The app moved to the background or the screen locked: no listening or talking there. */
  async onBackground(): Promise<void> {
    this.foreground = false;
    await this.interrupt();
  }

  onForeground(): void {
    this.foreground = true;
  }

  async endConversation(): Promise<void> {
    await this.interrupt();
    const sid = this.s.sessionId;
    this.set({ sessionId: null });
    if (sid) {
      this.deps.gateway.clearSession(sid).catch(() => undefined);
    }
  }

  /** Wipe the transcript and the server's copy of the conversation. */
  async clearHistory(): Promise<void> {
    // Read the session first: a caller may wipe the rest of the store straight after.
    const sid = this.s.sessionId;
    await this.interrupt();
    clearConversationState();
    if (sid) {
      await this.deps.gateway.clearSession(sid).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ replay ---

  async replay(messageId?: string): Promise<void> {
    const st = this.s;
    if (!this.pipeline || st.settings.textOnly || !st.synthAvailable) {
      return;
    }
    const target = messageId
      ? st.messages.find(m => m.id === messageId)
      : [...st.messages].reverse().find(m => m.role === 'assistant' && m.text);
    if (!target || !target.text) {
      return;
    }
    if (this.busy || this.pipeline.busy) {
      await this.interrupt();
    }
    // Replay is an explicit request, so it ignores "mute", but not "text only".
    const splitter = new SentenceSplitter();
    [...splitter.push(target.text), ...splitter.flush()].forEach(s =>
      this.pipeline!.enqueue(s, target.id),
    );
  }

  /** Mute: stop talking now and stay quiet until unmuted. */
  async setMuted(muted: boolean): Promise<void> {
    updateSettings({ muted });
    if (muted) {
      this.queuedSpeech = [];
      await this.pipeline?.stop();
    }
  }

  // ---------------------------------------------------------------- actions ---

  async runAction(
    messageId: string,
    actionId: string,
    options: { consent?: boolean } = {},
  ): Promise<void> {
    const msg = this.s.messages.find(m => m.id === messageId);
    const action = msg?.actions?.find(a => a.id === actionId);
    if (
      !msg ||
      !action ||
      (action.status !== 'suggested' && action.status !== 'pending_approval')
    ) {
      return;
    }
    const key = `${messageId}:${actionId}`;
    if (this.running.has(key)) {
      return; // a double tap must not run it twice
    }
    this.running.add(key);
    try {
      const outcome = await this.deps.performAction(action, options);
      this.patchAction(messageId, actionId, {
        status: outcome.status,
        result: outcome.message,
      });
      this.push({
        role: 'notice',
        via: 'system',
        kind: `action_${outcome.status}`,
        text: `${action.label}: ${outcome.message}`,
        level: outcome.status === 'completed' ? 'info' : 'action',
      });
    } finally {
      this.running.delete(key);
    }
  }

  dismissAction(messageId: string, actionId: string): void {
    this.update(messageId, m => ({
      actions: m.actions?.filter(a => a.id !== actionId),
    }));
  }

  private patchAction(
    messageId: string,
    actionId: string,
    patch: Partial<AssistantAction>,
  ): void {
    this.update(messageId, m => ({
      actions: m.actions?.map(a =>
        a.id === actionId ? { ...a, ...patch } : a,
      ),
    }));
  }

  // --------------------------------------------------------------- notices ---

  /**
   * A line from Orbit that the driver did not ask for: a proactive alert, or a
   * system message such as "microphone is off". Spoken only if allowed, and never
   * over the top of a conversation in progress.
   */
  notice(
    text: string,
    options: {
      level?: ChatMessage['level'];
      speak?: boolean;
      kind?: string;
      fallbacks?: FallbackLink[];
    } = {},
  ): ChatMessage {
    const msg = this.push({
      role: 'notice',
      via: 'proactive',
      text,
      level: options.level ?? 'info',
      kind: options.kind,
      ...(options.fallbacks ? { fallbacks: options.fallbacks } : {}),
    });
    if (options.speak !== false && this.shouldSpeak('proactive')) {
      if (this.s.phase === 'idle' && !this.busy && !this.pipeline?.busy) {
        this.pipeline!.enqueue(text, msg.id);
      } else if (this.s.phase !== 'listening') {
        this.queuedSpeech.push({ text, id: msg.id, at: this.now() });
      }
    }
    return msg;
  }
}

// ----------------------------------------------------------------- helpers ---

/** Only what the gateway accepts: known fields, within its length limits. */
function clampJourney(j: JourneyMemory): JourneyMemory {
  const out: JourneyMemory = {};
  const text = (
    k:
      | 'destination'
      | 'origin'
      | 'selected_station_id'
      | 'selected_station_name',
    max: number,
  ) => {
    if (j[k]) {
      out[k] = String(j[k]).slice(0, max);
    }
  };
  text('destination', 80);
  text('origin', 80);
  text('selected_station_id', 80);
  text('selected_station_name', 120);
  if (j.min_arrival_soc_pct !== undefined) {
    out.min_arrival_soc_pct = Math.max(
      0,
      Math.min(100, Math.round(j.min_arrival_soc_pct)),
    );
  }
  if (j.max_stops !== undefined) {
    out.max_stops = Math.max(0, Math.min(10, Math.round(j.max_stops)));
  }
  if (j.strategy) {
    out.strategy = j.strategy;
  }
  if (j.updated_at !== undefined) {
    out.updated_at = j.updated_at;
  }
  return out;
}

function localIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Apply what the model learned about the journey (only fields the memory knows). */
export function applyMemoryPatch(patch: Record<string, unknown>): void {
  if (patch.clear === true) {
    clearJourney();
    return;
  }
  const next: Partial<JourneyMemory> = {};
  const str = (k: keyof JourneyMemory) => {
    const v = patch[k];
    if (typeof v === 'string' && v.trim()) {
      (next as Record<string, unknown>)[k] = v.trim().slice(0, 120);
    }
  };
  const int = (k: keyof JourneyMemory) => {
    const v = patch[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      (next as Record<string, unknown>)[k] = Math.round(v);
    }
  };
  str('destination');
  str('origin');
  str('selected_station_id');
  str('selected_station_name');
  int('min_arrival_soc_pct');
  int('max_stops');
  if (
    patch.strategy === 'fastest' ||
    patch.strategy === 'cheapest' ||
    patch.strategy === 'reliable'
  ) {
    next.strategy = patch.strategy;
  }
  if (Object.keys(next).length > 0) {
    patchJourney(next);
  }
}
