import {AssistantController} from '../assistant/controller';
import type {ControllerDeps} from '../assistant/controller';
import {GatewayError} from '../assistant/gateway';
import type {Gateway, TurnBody} from '../assistant/gateway';
import {
  assistantStore,
  resetAssistantStore,
  updateSettings,
} from '../assistant/store';
import type {
  PermissionPort,
  RecognizerEvents,
  SpeakResult,
  SpeechRecognizerPort,
  SpeechSynthesizerPort,
  VoiceDeps,
} from '../assistant/voice/ports';
import type {
  PermissionState,
  StreamEvent,
  ToolCall,
  ToolEnvelope,
} from '../assistant/types';

/** A script for one HTTP call of a turn: the events to emit, or an error to throw. */
export type Script =
  | StreamEvent[]
  | Error
  | ((body: TurnBody, signal?: AbortSignal) => Promise<StreamEvent[]>);

export class FakeGateway implements Gateway {
  bodies: TurnBody[] = [];
  cleared: string[] = [];
  statusResult:
    | {
        enabled: boolean;
        reason?: string | null;
        provider: string;
        tools: string[];
      }
    | Error = {
    enabled: true,
    provider: 'anthropic',
    tools: [],
  };
  constructor(public scripts: Script[] = []) {}

  async streamTurn(
    body: TurnBody,
    onEvent: (e: StreamEvent) => void,
    options: {signal?: AbortSignal} = {},
  ) {
    this.bodies.push(JSON.parse(JSON.stringify(body)));
    const script = this.scripts.shift();
    if (script === undefined) {
      throw new Error('no script left for this request');
    }
    if (script instanceof Error) {
      throw script;
    }
    const events =
      typeof script === 'function'
        ? await script(body, options.signal)
        : script;
    for (const e of events) {
      if (options.signal?.aborted) {
        throw new GatewayError('CANCELLED', 'Cancelled.');
      }
      onEvent(e);
    }
  }
  async status() {
    if (this.statusResult instanceof Error) {
      throw this.statusResult;
    }
    return this.statusResult;
  }
  async clearSession(id: string) {
    this.cleared.push(id);
  }
  async clearAll() {
    this.cleared.push('*');
  }
}

export const session = (id = 's1', turn = 't1'): StreamEvent => ({
  type: 'session',
  session_id: id,
  turn_id: turn,
  resumed: false,
});
export const text = (delta: string): StreamEvent => ({type: 'text', delta});
export const done = (
  extra: Partial<Extract<StreamEvent, {type: 'done'}>> = {},
): StreamEvent => ({
  type: 'done',
  outcome: 'ok',
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    model_calls: 1,
    estimated_cost_usd: 0,
  },
  sources: [],
  ...extra,
});
export const toolRequests = (
  turn: string,
  ...calls: ToolCall[]
): StreamEvent => ({type: 'tool_requests', turn_id: turn, calls});

export class FakeRecognizer implements SpeechRecognizerPort {
  available = true;
  events: RecognizerEvents | null = null;
  locale = '';
  started = 0;
  stopped = 0;
  cancelled = 0;
  /** What stop() delivers, like a real engine's final result. */
  finalOnStop: string | null = null;
  async isAvailable() {
    return this.available;
  }
  async start(locale: string, events: RecognizerEvents) {
    this.started += 1;
    this.locale = locale;
    this.events = events;
  }
  async stop() {
    this.stopped += 1;
    if (this.finalOnStop !== null) {
      this.events?.onFinal(this.finalOnStop);
    }
    this.events?.onEnd();
  }
  async cancel() {
    this.cancelled += 1;
    this.events = null;
  }
}

export class FakeSynth implements SpeechSynthesizerPort {
  available = true;
  spoken: Array<{text: string; locale: string}> = [];
  stops = 0;
  /** Utterances stay "speaking" until finish() is called, to let tests interrupt. */
  manual = false;
  private waiting: Array<(r: SpeakResult) => void> = [];
  async isAvailable() {
    return this.available;
  }
  speak(utterance: string, options: {locale: string}) {
    this.spoken.push({text: utterance, locale: options.locale});
    if (!this.manual) {
      return Promise.resolve<SpeakResult>('done');
    }
    return new Promise<SpeakResult>(resolve => this.waiting.push(resolve));
  }
  finish(result: SpeakResult = 'done') {
    this.waiting.shift()?.(result);
  }
  async stop() {
    this.stops += 1;
    this.waiting.splice(0).forEach(w => w('cancelled'));
  }
}

export class FakePermissions implements PermissionPort {
  state: PermissionState = 'granted';
  onRequest: PermissionState | null = null;
  requests = 0;
  settingsOpened = 0;
  async microphone() {
    return this.state;
  }
  async requestMicrophone() {
    this.requests += 1;
    if (this.onRequest) {
      this.state = this.onRequest;
    }
    return this.state;
  }
  openSettings() {
    this.settingsOpened += 1;
  }
}

export function makeVoice() {
  const recognizer = new FakeRecognizer();
  const synthesizer = new FakeSynth();
  const permissions = new FakePermissions();
  const audio = {
    begun: 0,
    ended: 0,
    beginSpeaking() {
      this.begun += 1;
    },
    endSpeaking() {
      this.ended += 1;
    },
  };
  const voice: VoiceDeps = {recognizer, synthesizer, permissions, audio};
  return {voice, recognizer, synthesizer, permissions, audio};
}

export type Rig = ReturnType<typeof makeRig>;

export function makeRig(
  over: Partial<ControllerDeps> & {noVoice?: boolean; consent?: boolean} = {},
) {
  resetAssistantStore();
  const v = makeVoice();
  assistantStore.set({
    recognizerAvailable: true,
    synthAvailable: true,
    microphone: 'granted',
  });
  if (over.consent !== false) {
    updateSettings({aiConsentAt: 1});
  }
  const gateway = new FakeGateway();
  const toolCalls: ToolCall[] = [];
  const performed: string[] = [];
  const controller = new AssistantController({
    gateway,
    runTool: async (call): Promise<ToolEnvelope> => {
      toolCalls.push(call);
      return {status: 'ok', data: {echo: call.name}};
    },
    performAction: async action => {
      performed.push(action.id);
      return {status: 'completed', message: `did ${action.kind}`};
    },
    voice: over.noVoice ? null : v.voice,
    demo: true,
    silenceMs: 1400,
    ...over,
  });
  return {
    controller,
    gateway,
    toolCalls,
    performed,
    ...v,
    store: assistantStore,
  };
}

/** Let promises settle (microtasks) a few times. */
export const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
};
