import { NdjsonParser } from '../../src/assistant/ndjson';
import { Endpointer } from '../../src/assistant/voice/endpointing';
import { SpeechPipeline } from '../../src/assistant/voice/pipeline';
import { SentenceSplitter } from '../../src/assistant/voice/sentences';
import {
  hasDevanagari,
  localeFor,
  speakable,
} from '../../src/assistant/voice/speakable';
import { FakeSynth, flush } from '../../src/dev/assistantFakes';

describe('NdjsonParser', () => {
  it('parses lines split anywhere across chunks', () => {
    const p = new NdjsonParser();
    const line = JSON.stringify({ type: 'text', delta: 'नमस्ते' }) + '\n';
    const out: unknown[] = [];
    for (const ch of [line.slice(0, 7), line.slice(7, 19), line.slice(19)]) {
      out.push(...p.push(ch));
    }
    expect(out).toEqual([{ type: 'text', delta: 'नमस्ते' }]);
  });

  it('skips a garbled line and keeps going', () => {
    const p = new NdjsonParser();
    expect(p.push('{"a":1}\nnot json\n{"b":2}\n')).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  it('flushes a last line with no newline', () => {
    const p = new NdjsonParser();
    expect(p.push('{"a":1}\n{"b":2}')).toEqual([{ a: 1 }]);
    expect(p.flush()).toEqual([{ b: 2 }]);
    expect(p.flush()).toEqual([]);
  });
});

describe('SentenceSplitter', () => {
  const run = (parts: string[]) => {
    const s = new SentenceSplitter();
    const out = parts.flatMap(p => s.push(p));
    return [...out, ...s.flush()];
  };

  it('emits a sentence as soon as it is complete', () => {
    const s = new SentenceSplitter();
    expect(s.push('Your battery is fine. ')).toEqual(['Your battery is fine.']);
    expect(s.push('You need one ')).toEqual([]);
    expect(s.push('stop at Neemrana.')).toEqual([]); // may be followed by more
    expect(s.flush()).toEqual(['You need one stop at Neemrana.']);
  });

  it('does not split decimals or abbreviations', () => {
    expect(
      run(['It costs 12.5 rupees per unit, e.g. at Neemrana. Fine.']),
    ).toEqual(['It costs 12.5 rupees per unit, e.g. at Neemrana.', 'Fine.']);
  });

  it('splits Hindi sentences on the danda and keeps order across chunks', () => {
    expect(run(['आपकी बैटरी ठीक है। ', 'एक स्टॉप ', 'चाहिए।'])).toEqual([
      'आपकी बैटरी ठीक है।',
      'एक स्टॉप चाहिए।',
    ]);
  });

  it('cuts a very long sentence at a comma so speech starts sooner', () => {
    const long = `${'word '.repeat(20)}and another, ${'more '.repeat(30)}end.`;
    const out = run([long]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
  });

  it('reset forgets a half sentence', () => {
    const s = new SentenceSplitter();
    s.push('Half a sent');
    s.reset();
    expect(s.flush()).toEqual([]);
  });
});

describe('speakable text', () => {
  it.each([
    ['Arrive with 12% battery.', 'Arrive with 12 percent battery.'],
    ['It costs ₹1,200 in total.', 'It costs 1,200 rupees in total.'],
    ['₹18/kWh at 60 kW.', '18 rupees per kilowatt hour at 60 kilowatt.'],
    ['**Bold** and _italic_ and `code`', 'Bold and italic and code'],
    [
      'Use the CCS2 plug on the DC charger',
      'Use the C C S 2 plug on the D C charger',
    ],
    ['Jaipur is 280 km away', 'Jaipur is 280 kilometres away'],
    ['Great 🚗⚡ news', 'Great news'],
    ['See https://example.com/x now', 'See a link now'],
  ])('%s', (input, expected) => {
    expect(speakable(input)).toBe(expected);
  });

  it('leaves Devanagari text alone apart from the rupee sign', () => {
    expect(speakable('आपकी बैटरी 12% है')).toBe('आपकी बैटरी 12% है');
    expect(speakable('कीमत ₹500 है')).toBe('कीमत 500 rupees है');
  });

  it('picks the voice from the script', () => {
    expect(hasDevanagari('नमस्ते')).toBe(true);
    expect(localeFor('नमस्ते')).toBe('hi-IN');
    expect(localeFor('Namaste, aapki battery theek hai')).toBe('en-IN');
  });
});

describe('Endpointer', () => {
  beforeEach(() => jest.useFakeTimers());

  it('ends the utterance after a pause that follows speech', () => {
    const onEnd = jest.fn();
    const e = new Endpointer(onEnd, 1000, 20_000);
    e.start();
    e.heardSpeech();
    jest.advanceTimersByTime(900);
    e.heardSpeech(); // more words restart the pause clock
    jest.advanceTimersByTime(900);
    expect(onEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(onEnd).toHaveBeenCalledWith('silence');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not end on silence before anything was said', () => {
    const onEnd = jest.fn();
    const e = new Endpointer(onEnd, 1000, 20_000);
    e.start();
    jest.advanceTimersByTime(10_000);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('always ends at the maximum length', () => {
    const onEnd = jest.fn();
    const e = new Endpointer(onEnd, 1000, 5000);
    e.start();
    jest.advanceTimersByTime(5000);
    expect(onEnd).toHaveBeenCalledWith('max');
  });

  it('stop cancels everything', () => {
    const onEnd = jest.fn();
    const e = new Endpointer(onEnd, 1000, 5000);
    e.start();
    e.heardSpeech();
    e.stop();
    jest.advanceTimersByTime(10_000);
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('SpeechPipeline', () => {
  it('recovers from a rejected native speech promise without losing queued speech', async () => {
    const synth = new FakeSynth();
    const original = synth.speak.bind(synth);
    let calls = 0;
    synth.speak = async (text, options) => {
      if (calls++ === 0) {
        throw new Error('audio engine disconnected');
      }
      return original(text, options);
    };
    const audio = { beginSpeaking: jest.fn(), endSpeaking: jest.fn() };
    const pipeline = new SpeechPipeline(synth, audio, {
      onSpeaking: jest.fn(),
    });
    pipeline.enqueue('First sentence.');
    pipeline.enqueue('Still available in text and speech.');
    await pipeline.whenIdle();
    expect(synth.spoken).toHaveLength(1);
    expect(pipeline.busy).toBe(false);
    expect(audio.endSpeaking).toHaveBeenCalledTimes(1);
  });
  const audio = () => ({
    begun: 0,
    ended: 0,
    beginSpeaking() {
      this.begun++;
    },
    endSpeaking() {
      this.ended++;
    },
  });

  it('speaks queued sentences in order and restores other audio when done', async () => {
    const synth = new FakeSynth();
    const a = audio();
    const states: Array<[string | null, boolean]> = [];
    const p = new SpeechPipeline(synth, a, {
      onSpeaking: (id, on) => states.push([id, on]),
    });
    p.enqueue('First one.', 'm1');
    p.enqueue('Second one.', 'm1');
    p.enqueue('Next message.', 'm2');
    await p.whenIdle();
    expect(synth.spoken.map(s => s.text)).toEqual([
      'First one.',
      'Second one.',
      'Next message.',
    ]);
    expect(states).toEqual([
      ['m1', true],
      ['m2', true],
      [null, false],
    ]);
    expect([a.begun, a.ended]).toEqual([1, 1]);
    expect(p.busy).toBe(false);
  });

  it('ignores text with nothing to say', async () => {
    const synth = new FakeSynth();
    const p = new SpeechPipeline(synth, audio(), {
      onSpeaking: () => undefined,
    });
    p.enqueue('  **  ', 'm1');
    expect(synth.spoken).toEqual([]);
    expect(p.busy).toBe(false);
  });

  it('stop cuts the current sentence and drops the rest', async () => {
    const synth = new FakeSynth();
    synth.manual = true;
    const a = audio();
    const p = new SpeechPipeline(synth, a, { onSpeaking: () => undefined });
    p.enqueue('Talking for a while.', 'm1');
    p.enqueue('Never spoken.', 'm1');
    await flush();
    expect(synth.spoken).toHaveLength(1);
    await p.stop();
    await p.whenIdle();
    expect(synth.spoken).toHaveLength(1);
    expect(p.busy).toBe(false);
    expect(a.ended).toBe(a.begun);
  });

  it('can speak again straight after a stop', async () => {
    const synth = new FakeSynth();
    synth.manual = true;
    const p = new SpeechPipeline(synth, audio(), {
      onSpeaking: () => undefined,
    });
    p.enqueue('Old words.', 'm1');
    await flush();
    const stopping = p.stop();
    p.enqueue('New words.', 'm2');
    await stopping;
    await flush();
    expect(synth.spoken.map(s => s.text)).toEqual(['Old words.', 'New words.']);
    synth.finish('done');
    await p.whenIdle();
    expect(p.busy).toBe(false);
  });

  it('drops the rest of an answer if the OS cancels it (a call came in)', async () => {
    const synth = new FakeSynth();
    synth.manual = true;
    const p = new SpeechPipeline(synth, audio(), {
      onSpeaking: () => undefined,
    });
    p.enqueue('First part.', 'm1');
    p.enqueue('Second part.', 'm1');
    await flush();
    synth.finish('cancelled');
    await p.whenIdle();
    expect(synth.spoken.map(s => s.text)).toEqual(['First part.']);
  });

  it('keeps going if one sentence fails to speak', async () => {
    const synth = new FakeSynth();
    const original = synth.speak.bind(synth);
    let n = 0;
    synth.speak = async (text, o) => {
      await original(text, o);
      return n++ === 0 ? 'error' : 'done';
    };
    const p = new SpeechPipeline(synth, audio(), {
      onSpeaking: () => undefined,
    });
    p.enqueue('Fails.', 'm1');
    p.enqueue('Still spoken.', 'm1');
    await p.whenIdle();
    expect(synth.spoken.map(s => s.text)).toEqual(['Fails.', 'Still spoken.']);
  });
});
