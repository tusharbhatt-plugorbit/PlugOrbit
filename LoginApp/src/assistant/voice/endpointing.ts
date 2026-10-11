/**
 * Decides when the driver has finished speaking. The OS recognisers differ:
 * Android usually ends by itself after a pause, iOS keeps listening while the
 * engine runs. So Orbit does its own: once words have been heard, a pause of
 * `silenceMs` without new words ends the utterance, and `maxMs` bounds it.
 */
export class Endpointer {
  private silence: ReturnType<typeof setTimeout> | null = null;
  private max: ReturnType<typeof setTimeout> | null = null;
  private heard = false;

  constructor(
    private readonly onEnd: (reason: 'silence' | 'max') => void,
    private readonly silenceMs = 1400,
    private readonly maxMs = 25_000,
  ) {}

  start(): void {
    this.stop();
    this.heard = false;
    this.max = setTimeout(() => this.fire('max'), this.maxMs);
  }

  /** Words were recognised: speech is under way, so restart the pause clock. */
  heardSpeech(): void {
    this.heard = true;
    if (this.silence) {
      clearTimeout(this.silence);
    }
    this.silence = setTimeout(() => this.fire('silence'), this.silenceMs);
  }

  stop(): void {
    if (this.silence) {
      clearTimeout(this.silence);
    }
    if (this.max) {
      clearTimeout(this.max);
    }
    this.silence = null;
    this.max = null;
  }

  private fire(reason: 'silence' | 'max'): void {
    const hadSpeech = this.heard;
    this.stop();
    if (reason === 'max' || hadSpeech) {
      this.onEnd(reason);
    }
  }
}
