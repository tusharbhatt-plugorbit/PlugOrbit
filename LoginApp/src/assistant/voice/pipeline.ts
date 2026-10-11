import type {AudioSessionPort, SpeechSynthesizerPort} from './ports';
import {localeFor, speakable} from './speakable';

/**
 * Speaks sentences one after another, in order, and can be cut off instantly.
 * It owns the audio-session politeness: other audio is lowered when Orbit starts
 * talking and restored when it stops, whatever the reason it stopped.
 */
export class SpeechPipeline {
  private queue: Array<{text: string; id: string | null}> = [];
  private running = false;
  private generation = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly synth: SpeechSynthesizerPort,
    private readonly audio: AudioSessionPort,
    private readonly hooks: {
      onSpeaking: (id: string | null, speaking: boolean) => void;
      rate?: number;
    },
  ) {}

  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  enqueue(text: string, id: string | null = null): void {
    const clean = speakable(text);
    if (!clean) {
      return;
    }
    this.queue.push({text: clean, id});
    if (!this.running) {
      this.drain(this.generation);
    }
  }

  /** Stop talking now and forget everything queued. */
  async stop(): Promise<void> {
    this.generation += 1;
    this.queue = [];
    try {
      await this.synth.stop();
    } catch {
      // Nothing was speaking, or the engine is gone: either way we are quiet.
    }
  }

  whenIdle(): Promise<void> {
    return this.busy
      ? new Promise<void>(resolve => this.idleWaiters.push(resolve))
      : Promise.resolve();
  }

  private async drain(generation: number): Promise<void> {
    this.running = true;
    this.audio.beginSpeaking();
    let current: string | null = null;
    try {
      while (this.queue.length > 0 && generation === this.generation) {
        const next = this.queue.shift()!;
        if (next.id !== current) {
          current = next.id;
          this.hooks.onSpeaking(current, true);
        }
        const result = await this.synth.speak(next.text, {
          locale: localeFor(next.text),
          rate: this.hooks.rate,
        });
        if (result === 'cancelled') {
          // Stopped by us (generation moved on) or by the OS, e.g. a phone call or
          // another app taking audio focus. Either way the rest of the answer is not
          // read out later, out of place.
          if (generation === this.generation) {
            this.queue = [];
          }
          break;
        }
        // 'error': one failed sentence should not silence the rest of the answer; a
        // dead engine fails them all quickly and the queue empties.
      }
    } finally {
      this.running = false;
      this.audio.endSpeaking();
      this.hooks.onSpeaking(null, false);
      if (this.queue.length > 0) {
        // Something was queued after stop() while this drain was still unwinding.
        this.drain(this.generation);
      } else {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        waiters.forEach(w => w());
      }
    }
  }
}
