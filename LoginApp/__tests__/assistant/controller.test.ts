import {GatewayError} from '../../src/assistant/gateway';
import {
  assistantStore,
  clearJourney,
  savePreference,
  updateSettings,
} from '../../src/assistant/store';
import {
  FakeGateway,
  done,
  flush,
  makeRig,
  session,
  text,
  toolRequests,
} from '../../src/dev/assistantFakes';

jest.useFakeTimers();

const last = (rig: ReturnType<typeof makeRig>) =>
  rig.store.get().messages[rig.store.get().messages.length - 1];

describe('a typed question', () => {
  it('streams the answer into the transcript and stays silent', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      [session('s1'), text('You have '), text('enough battery.'), done()],
    ];
    expect(await rig.controller.send('Do I need to charge?')).toBe(true);
    const [user, reply] = rig.store.get().messages;
    expect(user).toMatchObject({
      role: 'user',
      text: 'Do I need to charge?',
      via: 'text',
    });
    expect(reply).toMatchObject({
      role: 'assistant',
      text: 'You have enough battery.',
      streaming: false,
    });
    expect(rig.store.get().sessionId).toBe('s1');
    expect(rig.store.get().phase).toBe('idle');
    expect(rig.synthesizer.spoken).toEqual([]); // typed, not driving: no talking
  });

  it('is refused until the driver has agreed to AI use', async () => {
    const rig = makeRig({consent: false});
    expect(await rig.controller.send('hello')).toBe(false);
    expect(rig.gateway.bodies).toHaveLength(0);
    expect(rig.store.get().messages).toHaveLength(0);
  });

  it('sends the session, settings and what the driver said about the journey', async () => {
    const rig = makeRig();
    updateSettings({
      voiceLanguage: 'hinglish',
      responseStyle: 'detailed',
      drivingMode: true,
    });
    assistantStore.set({
      journey: {
        destination: 'Jaipur',
        min_arrival_soc_pct: 20,
        updated_at: Date.now(),
      },
    });
    rig.gateway.scripts = [
      [session('s1'), text('Ok.'), done()],
      [session('s1'), text('Sure.'), done()],
    ];
    await rig.controller.send('kitna time lagega');
    await rig.controller.send('and the cost?');
    const first = rig.gateway.bodies[0] as any;
    expect(first.session_id).toBeUndefined();
    expect(first.message).toBe('kitna time lagega');
    expect(first.context).toMatchObject({
      voice_language: 'hinglish',
      response_style: 'detailed',
      driving_mode: true,
      demo_data: true,
      journey: {destination: 'Jaipur', min_arrival_soc_pct: 20},
    });
    expect(first.context.local_time).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/,
    );
    expect((rig.gateway.bodies[1] as any).session_id).toBe('s1'); // follow-up keeps the conversation
  });

  it('forgets a journey the driver has not mentioned for hours', async () => {
    const rig = makeRig();
    assistantStore.set({
      journey: {destination: 'Jaipur', updated_at: Date.now() - 7 * 3600_000},
    });
    rig.gateway.scripts = [[session(), text('Hi.'), done()]];
    await rig.controller.send('hello');
    expect((rig.gateway.bodies[0] as any).context.journey).toBeUndefined();
  });

  it('only shares remembered preferences while the driver allows it', async () => {
    const rig = makeRig();
    updateSettings({rememberPreferences: true});
    savePreference('prioritise', 'cost');
    rig.gateway.scripts = [
      [session(), text('a'), done()],
      [session(), text('b'), done()],
    ];
    await rig.controller.send('one');
    updateSettings({rememberPreferences: false});
    await rig.controller.send('two');
    expect(
      (rig.gateway.bodies[0] as any).context.remembered_preferences,
    ).toHaveLength(1);
    expect(
      (rig.gateway.bodies[1] as any).context.remembered_preferences,
    ).toHaveLength(0);
  });
});

describe('tools on the phone', () => {
  it('runs the requested tools and sends the results back on the same turn', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      [
        session('s1', 't9'),
        text('Checking. '),
        toolRequests(
          't9',
          {id: 'c1', name: 'get_battery_level', input: {}},
          {id: 'c2', name: 'get_vehicle_status', input: {}},
        ),
      ],
      [
        text('You are at 60 percent.'),
        done({
          sources: [
            {
              tool: 'get_battery_level',
              demo: true,
              status: 'ok',
              trust: 'user',
            },
          ],
        }),
      ],
    ];
    await rig.controller.send('battery?');
    expect(rig.toolCalls.map(c => c.name)).toEqual([
      'get_battery_level',
      'get_vehicle_status',
    ]);
    const second = rig.gateway.bodies[1] as any;
    expect(second).toMatchObject({session_id: 's1', turn_id: 't9'});
    expect(
      second.tool_results.map((r: any) => [r.tool_use_id, r.status]),
    ).toEqual([
      ['c1', 'ok'],
      ['c2', 'ok'],
    ]);
    expect(second.message).toBeUndefined();
    const reply = last(rig);
    expect(reply.text).toBe('Checking. You are at 60 percent.');
    expect(reply.sources?.[0]).toMatchObject({
      tool: 'get_battery_level',
      trust: 'user',
    });
  });

  it('stops looping after a bounded number of rounds', async () => {
    const rig = makeRig();
    rig.gateway.scripts = Array.from({length: 12}, (_, i) => [
      toolRequests(`t${i}`, {
        id: `c${i}`,
        name: 'get_battery_level',
        input: {},
      }),
    ]);
    await rig.controller.send('loop');
    expect(rig.gateway.bodies.length).toBeLessThanOrEqual(8);
  });

  it('remembers what the model learned about the journey', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      [
        session(),
        {
          type: 'memory',
          patch: {
            destination: 'Jaipur',
            min_arrival_soc_pct: 20,
            strategy: 'cheapest',
            bogus: 'x',
          },
        },
        text('Got it.'),
        done(),
      ],
    ];
    await rig.controller.send('Jaipur, at least 20%');
    expect(rig.store.get().journey).toMatchObject({
      destination: 'Jaipur',
      min_arrival_soc_pct: 20,
      strategy: 'cheapest',
    });
    expect(rig.store.get().journey).not.toHaveProperty('bogus');
    rig.gateway.scripts = [
      [
        session(),
        {type: 'memory', patch: {clear: true}},
        text('Cleared.'),
        done(),
      ],
    ];
    await rig.controller.send('forget it');
    expect(rig.store.get().journey).toBeNull();
    clearJourney();
  });
});

describe('speaking', () => {
  it('speaks a voice answer sentence by sentence as it streams', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      [
        session(),
        text('Your arrival battery is 12%, below your 20% reserve. '),
        text('I recommend one charging stop.'),
        done(),
      ],
    ];
    await rig.controller.send('Do I need to charge?', 'voice');
    await flush();
    expect(rig.synthesizer.spoken.map(s => s.text)).toEqual([
      'Your arrival battery is 12 percent, below your 20 percent reserve.',
      'I recommend one charging stop.',
    ]);
    expect(rig.synthesizer.spoken.every(s => s.locale === 'en-IN')).toBe(true);
    expect(rig.audio.begun).toBeGreaterThan(0);
    expect(rig.audio.ended).toBe(rig.audio.begun);
    expect(rig.store.get().phase).toBe('idle');
  });

  it('uses a Hindi voice for Devanagari text', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      [session(), text('आपकी बैटरी पर्याप्त है।'), done()],
    ];
    await rig.controller.send('बैटरी?', 'voice');
    await flush();
    expect(rig.synthesizer.spoken[0].locale).toBe('hi-IN');
  });

  it('speaks typed questions only in driving mode', async () => {
    const rig = makeRig();
    updateSettings({drivingMode: true});
    rig.gateway.scripts = [[session(), text('Yes, one stop.'), done()]];
    await rig.controller.send('stops?');
    await flush();
    expect(rig.synthesizer.spoken).toHaveLength(1);
  });

  it('never speaks in text-only mode or while muted', async () => {
    const rig = makeRig();
    updateSettings({textOnly: true});
    rig.gateway.scripts = [[session(), text('Hello there.'), done()]];
    await rig.controller.send('hi', 'voice');
    await flush();
    expect(rig.synthesizer.spoken).toHaveLength(0);
    updateSettings({textOnly: false, muted: true});
    rig.gateway.scripts = [[session(), text('Hello again.'), done()]];
    await rig.controller.send('hi', 'voice');
    await flush();
    expect(rig.synthesizer.spoken).toHaveLength(0);
  });

  it('replays the last answer even when muted, but not in text-only mode', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      [session(), text('Take the Neemrana stop.'), done()],
    ];
    await rig.controller.send('where?');
    updateSettings({muted: true});
    await rig.controller.replay();
    await flush();
    expect(rig.synthesizer.spoken.map(s => s.text)).toEqual([
      'Take the Neemrana stop.',
    ]);
    updateSettings({textOnly: true});
    await rig.controller.replay();
    await flush();
    expect(rig.synthesizer.spoken).toHaveLength(1);
  });

  it('muting stops speech immediately', async () => {
    const rig = makeRig();
    rig.synthesizer.manual = true;
    rig.gateway.scripts = [
      [session(), text('A long answer. And more.'), done()],
    ];
    await rig.controller.send('tell me', 'voice');
    await flush();
    expect(rig.store.get().phase).toBe('speaking');
    await rig.controller.setMuted(true);
    await flush();
    expect(rig.synthesizer.stops).toBeGreaterThan(0);
    expect(rig.store.get().settings.muted).toBe(true);
    expect(rig.store.get().phase).toBe('idle');
  });
});

describe('interruption', () => {
  it('cuts off speech at once when the driver interrupts', async () => {
    const rig = makeRig();
    rig.synthesizer.manual = true;
    rig.gateway.scripts = [
      [
        session(),
        text('This is a long first sentence. '),
        text('And a second.'),
        done(),
      ],
    ];
    await rig.controller.send('explain', 'voice');
    await flush();
    expect(rig.store.get().phase).toBe('speaking');
    await rig.controller.interrupt();
    expect(rig.synthesizer.stops).toBeGreaterThan(0);
    expect(rig.store.get().phase).toBe('idle');
    expect(rig.store.get().speakingId).toBeNull();
    expect(rig.audio.ended).toBe(rig.audio.begun); // other audio is restored
  });

  it('aborts the request that is still in flight', async () => {
    const rig = makeRig();
    let aborted = false;
    rig.gateway.scripts = [
      (_b, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => {
            aborted = true;
            reject(new GatewayError('CANCELLED', 'Cancelled.'));
          });
        }),
    ];
    const pending = rig.controller.send('slow one');
    await flush();
    expect(rig.store.get().phase).toBe('thinking');
    await rig.controller.interrupt();
    await pending;
    expect(aborted).toBe(true);
    expect(rig.store.get().phase).toBe('idle');
    expect(rig.controller.busy).toBe(false);
  });

  it('keeps a half-written answer, marked as interrupted, and ignores late events', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    const gateway = new FakeGateway();
    gateway.streamTurn = async (_body, onEvent) => {
      onEvent(session());
      onEvent(text('You will arrive with '));
      await gate;
      onEvent(text('LATE WORDS')); // arrives after the interruption
      onEvent(done());
    };
    const rig = makeRig({gateway});
    const pending = rig.controller.send('arrival?');
    await flush();
    expect(last(rig).text).toBe('You will arrive with ');
    await rig.controller.interrupt();
    release();
    await pending;
    expect(last(rig)).toMatchObject({
      text: 'You will arrive with ',
      interrupted: true,
      streaming: false,
    });
    expect(rig.store.get().phase).toBe('idle');
  });

  it('a new question replaces the one in progress', async () => {
    const rig = makeRig();
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    rig.gateway.scripts = [
      async () => {
        await gate;
        return [session('old'), text('old answer'), done()];
      },
      [session('new'), text('new answer'), done()],
    ];
    const first = rig.controller.send('first');
    await flush();
    await rig.controller.send('second');
    release();
    await first;
    const texts = rig.store
      .get()
      .messages.filter(m => m.role === 'assistant')
      .map(m => m.text);
    expect(texts).toContain('new answer');
    expect(texts).not.toContain('old answer');
    expect(rig.store.get().sessionId).toBe('new');
  });

  it('stops talking and listening when the app goes to the background', async () => {
    const rig = makeRig();
    await rig.controller.startListening();
    expect(rig.store.get().phase).toBe('listening');
    await rig.controller.onBackground();
    expect(rig.recognizer.cancelled).toBeGreaterThan(0);
    expect(rig.store.get().phase).toBe('idle');
  });
});

describe('microphone', () => {
  it('listens, shows partial words, and sends after the driver pauses', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [[session(), text('Sure. I will plan it.'), done()]];
    await rig.controller.startListening();
    expect(rig.store.get().phase).toBe('listening');
    expect(rig.recognizer.locale).toBe('en-IN');
    rig.recognizer.events!.onPartial('Orbit Jaipur');
    expect(rig.store.get().partial).toBe('Orbit Jaipur');
    rig.recognizer.finalOnStop = 'Orbit Jaipur jaana hai';
    jest.advanceTimersByTime(1500); // the pause ends the utterance
    await flush(12);
    const user = rig.store.get().messages.find(m => m.role === 'user')!;
    expect(user).toMatchObject({text: 'Orbit Jaipur jaana hai', via: 'voice'});
    expect(rig.recognizer.stopped).toBe(1);
    expect(rig.synthesizer.spoken.length).toBeGreaterThan(0); // spoken because it was a voice question
  });

  it('sends the partial text when the engine ends without a final result', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [[session(), text('Okay.'), done()]];
    await rig.controller.startListening();
    rig.recognizer.events!.onPartial('what is my battery');
    await rig.controller.stopListening();
    await flush(12);
    expect(rig.store.get().messages.find(m => m.role === 'user')?.text).toBe(
      'what is my battery',
    );
  });

  it('uses a Hindi recognizer for Hindi and Hinglish', async () => {
    const rig = makeRig();
    updateSettings({voiceLanguage: 'hi'});
    await rig.controller.startListening();
    expect(rig.recognizer.locale).toBe('hi-IN');
  });

  it('tapping the mic while Orbit is speaking interrupts it first', async () => {
    const rig = makeRig();
    rig.synthesizer.manual = true;
    rig.gateway.scripts = [
      [session(), text('A long answer to read out. More follows.'), done()],
    ];
    await rig.controller.send('tell me', 'voice');
    await flush();
    expect(rig.store.get().phase).toBe('speaking');
    await rig.controller.toggleMic();
    expect(rig.synthesizer.stops).toBeGreaterThan(0);
    expect(rig.store.get().phase).toBe('listening');
  });

  it('asks for permission once and explains a refusal without crashing', async () => {
    const rig = makeRig();
    rig.permissions.state = 'unknown';
    rig.permissions.onRequest = 'denied';
    await rig.controller.startListening();
    expect(rig.permissions.requests).toBe(1);
    expect(rig.recognizer.started).toBe(0);
    expect(rig.store.get().microphone).toBe('denied');
    expect(last(rig)).toMatchObject({role: 'notice', kind: 'mic_permission'});
    expect(last(rig).text).toMatch(/microphone/i);
    expect(rig.store.get().phase).toBe('idle');
  });

  it('says where to turn the microphone on when it is blocked', async () => {
    const rig = makeRig();
    rig.permissions.state = 'blocked';
    await rig.controller.startListening();
    expect(last(rig).text).toMatch(/settings/i);
  });

  it.each([
    ['no_speech', /didn’t catch/],
    ['network', /connection/],
    ['busy', /in use/],
    ['unavailable', /no speech recognition/],
  ] as const)('explains a %s recognizer error', async (code, pattern) => {
    const rig = makeRig();
    await rig.controller.startListening();
    rig.recognizer.events!.onError(code, 'x');
    expect(rig.store.get().phase).toBe('idle');
    expect(last(rig).text).toMatch(pattern);
    if (code === 'unavailable') {
      expect(rig.store.get().recognizerAvailable).toBe(false);
    }
  });

  it('falls back to typing when the speech module is not in the build', async () => {
    const rig = makeRig({noVoice: true});
    await rig.controller.startListening();
    expect(last(rig).text).toMatch(/type/i);
    rig.gateway.scripts = [[session(), text('Typed answers work.'), done()]];
    await rig.controller.send('hello');
    expect(last(rig).text).toBe('Typed answers work.');
  });

  it('does not listen before the driver has agreed to AI use', async () => {
    const rig = makeRig({consent: false});
    await rig.controller.startListening();
    expect(rig.recognizer.started).toBe(0);
  });
});

describe('when things go wrong', () => {
  it.each([
    ['OFFLINE', /offline/i, 'offline'],
    ['NO_SESSION', /signed in/i, 'signed_out'],
    ['UNAVAILABLE', /isn’t available/i, 'unavailable'],
  ] as const)(
    'explains %s and points to the planner',
    async (code, pattern, health) => {
      const rig = makeRig();
      rig.gateway.scripts = [new GatewayError(code, 'x')];
      await rig.controller.send('help');
      const reply = last(rig);
      expect(reply.error).toMatch(pattern);
      expect(reply.fallbacks?.map(f => f.route)).toContain('RoutePlanner');
      expect(rig.store.get().gateway.health).toBe(health);
      expect(rig.store.get().phase).toBe('idle');
    },
  );

  it('tells the driver how long to wait when rate limited', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      new GatewayError('RATE_LIMITED', 'x', {retryAfter: 12}),
    ];
    await rig.controller.send('again');
    expect(last(rig).error).toMatch(/12 seconds/);
  });

  it('keeps the words already received when the stream fails part-way', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      [
        session(),
        text('You will arrive with '),
        {
          type: 'error',
          code: 'PROVIDER_TIMEOUT',
          message: 'The assistant took too long to answer.',
          retryable: true,
        },
      ],
    ];
    await rig.controller.send('arrival?');
    const reply = last(rig);
    expect(reply).toMatchObject({
      text: 'You will arrive with ',
      interrupted: true,
      error: 'The assistant took too long to answer.',
    });
    expect(reply.fallbacks).toBeDefined();
  });

  it('starts a fresh conversation once if the server forgot this one', async () => {
    const rig = makeRig();
    assistantStore.set({sessionId: 'stale'});
    rig.gateway.scripts = [
      new GatewayError('SESSION_LOST', 'gone', {status: 404}),
      [session('fresh'), text('Here you go.'), done()],
    ];
    await rig.controller.send('where were we');
    expect((rig.gateway.bodies[0] as any).session_id).toBe('stale');
    expect((rig.gateway.bodies[1] as any).session_id).toBeUndefined();
    expect(rig.store.get().sessionId).toBe('fresh');
    expect(
      rig.store.get().messages.filter(m => m.role === 'user'),
    ).toHaveLength(1);
    expect(last(rig).text).toBe('Here you go.');
  });

  it('does not loop if the server keeps forgetting', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [
      new GatewayError('SESSION_LOST', 'gone'),
      new GatewayError('SESSION_LOST', 'gone'),
    ];
    await rig.controller.send('hi');
    expect(rig.gateway.bodies).toHaveLength(2);
    expect(last(rig).error).toBeTruthy();
  });

  it('records gateway health from the status check', async () => {
    const rig = makeRig();
    await rig.controller.refreshGateway();
    expect(rig.store.get().gateway.health).toBe('ready');
    rig.gateway.statusResult = {
      enabled: false,
      reason: 'No key',
      provider: 'none',
      tools: [],
    };
    await rig.controller.refreshGateway();
    expect(rig.store.get().gateway).toMatchObject({
      health: 'unavailable',
      reason: 'No key',
    });
    rig.gateway.statusResult = new GatewayError('NO_SESSION', 'x');
    await rig.controller.refreshGateway();
    expect(rig.store.get().gateway.health).toBe('signed_out');
  });
});

describe('actions the driver approves', () => {
  const withAction = (
    status: 'suggested' | 'pending_approval' = 'pending_approval',
  ) => [
    session(),
    text('I can set that up.'),
    {
      type: 'actions' as const,
      actions: [
        {
          id: 'a1',
          kind: 'start_journey' as const,
          label: 'Start trip to Jaipur',
          params: {destination: 'Jaipur'},
          status,
        },
      ],
    },
    done(),
  ];

  it('shows the button as waiting for approval, and does nothing until tapped', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [withAction()];
    await rig.controller.send('take me to Jaipur');
    expect(last(rig).actions?.[0]).toMatchObject({status: 'pending_approval'});
    expect(rig.performed).toEqual([]);
  });

  it('performs it once, even on a double tap, and records the real outcome', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [withAction()];
    await rig.controller.send('take me to Jaipur');
    const id = last(rig).id;
    await Promise.all([
      rig.controller.runAction(id, 'a1'),
      rig.controller.runAction(id, 'a1'),
    ]);
    expect(rig.performed).toEqual(['a1']);
    const action = rig.store.get().messages.find(m => m.id === id)!.actions![0];
    expect(action).toMatchObject({
      status: 'completed',
      result: 'did start_journey',
    });
    await rig.controller.runAction(id, 'a1'); // already completed
    expect(rig.performed).toEqual(['a1']);
  });

  it('shows a failed action as failed, never as done', async () => {
    const rig = makeRig({
      performAction: async () => ({
        status: 'failed',
        message: 'No compatible charger was found.',
      }),
    });
    rig.gateway.scripts = [withAction()];
    await rig.controller.send('go');
    await rig.controller.runAction(last(rig).id, 'a1');
    const msg = rig.store.get().messages.find(m => m.role === 'assistant')!;
    expect(msg.actions![0]).toMatchObject({
      status: 'failed',
      result: 'No compatible charger was found.',
    });
    expect(rig.store.get().messages.some(m => m.kind === 'action_failed')).toBe(
      true,
    );
  });

  it('can be dismissed without doing anything', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [withAction('suggested')];
    await rig.controller.send('go');
    rig.controller.dismissAction(last(rig).id, 'a1');
    expect(last(rig).actions).toEqual([]);
    expect(rig.performed).toEqual([]);
  });
});

describe('conversation controls', () => {
  it('ending a conversation stops audio and forgets the server copy', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [[session('s7'), text('Hi.'), done()]];
    await rig.controller.send('hello');
    await rig.controller.endConversation();
    expect(rig.gateway.cleared).toEqual(['s7']);
    expect(rig.store.get().sessionId).toBeNull();
    expect(rig.store.get().messages.length).toBeGreaterThan(0); // transcript stays readable
  });

  it('clearing history wipes the transcript and the server copy', async () => {
    const rig = makeRig();
    rig.gateway.scripts = [[session('s8'), text('Hi.'), done()]];
    await rig.controller.send('hello');
    await rig.controller.clearHistory();
    expect(rig.store.get().messages).toEqual([]);
    expect(rig.gateway.cleared).toEqual(['s8']);
  });
});

describe('notices Orbit raises on its own', () => {
  it('speaks when idle and the driver allows it', async () => {
    const rig = makeRig();
    rig.controller.notice('Your charging stop is 5 minutes ahead.', {
      level: 'action',
      kind: 'stop_imminent',
    });
    await flush();
    expect(rig.synthesizer.spoken.map(s => s.text)).toEqual([
      'Your charging stop is 5 minutes ahead.',
    ]);
    expect(last(rig)).toMatchObject({
      role: 'notice',
      kind: 'stop_imminent',
      level: 'action',
    });
  });

  it('waits for a conversation in progress, then speaks', async () => {
    const rig = makeRig();
    let release: () => void = () => {};
    const gate = new Promise<void>(r => {
      release = r;
    });
    rig.gateway.scripts = [
      async () => {
        await gate;
        return [session(), text('Answer.'), done()];
      },
    ];
    const pending = rig.controller.send('question', 'voice');
    await flush();
    rig.controller.notice('Charger ahead is busy.', {
      kind: 'charger_getting_busy',
    });
    expect(rig.synthesizer.spoken).toHaveLength(0);
    release();
    await pending;
    await flush(12);
    const said = rig.synthesizer.spoken.map(s => s.text);
    expect(said).toContain('Answer.');
    expect(said).toContain('Charger ahead is busy.');
    expect(said.indexOf('Answer.')).toBeLessThan(
      said.indexOf('Charger ahead is busy.'),
    );
  });

  it('stays silent in text-only mode but still shows the notice', async () => {
    const rig = makeRig();
    updateSettings({textOnly: true});
    rig.controller.notice('Plan changed.', {kind: 'plan_changed'});
    await flush();
    expect(rig.synthesizer.spoken).toHaveLength(0);
    expect(last(rig).text).toBe('Plan changed.');
  });

  it('is included in the next question’s context so follow-ups make sense', async () => {
    const rig = makeRig();
    rig.controller.notice('Your usual charger is offline.', {
      kind: 'charger_unavailable',
      speak: false,
    });
    rig.gateway.scripts = [
      [session(), text('Let me check alternatives.'), done()],
    ];
    await rig.controller.send('what now?');
    const ctx = (rig.gateway.bodies[0] as any).context;
    expect(ctx.recent_events[0]).toMatchObject({
      kind: 'charger_unavailable',
      text: 'Your usual charger is offline.',
    });
  });
});
