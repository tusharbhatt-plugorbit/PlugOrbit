import React from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Renderer, {act} from 'react-test-renderer';
import {
  KeyboardAvoider,
  KeyboardAwareScrollView,
} from '../src/ui/KeyboardAware';
import {keyboardOverlap, scrollDeltaToReveal} from '../src/ui/keyboardMath';

describe('keyboardOverlap', () => {
  const kb = {top: 360, height: 280};

  test('a view that runs to the bottom of an un-resized window is covered by the whole keyboard', () => {
    expect(keyboardOverlap({top: 0, height: 640}, kb)).toBe(280);
  });

  test('a window already resized above the keyboard is not compensated again', () => {
    // adjustResize: the view now ends where the keyboard starts.
    expect(keyboardOverlap({top: 0, height: 360}, kb)).toBe(0);
  });

  test('only the covered part counts', () => {
    expect(keyboardOverlap({top: 100, height: 400}, kb)).toBe(140);
  });

  test('a view that ends above the keyboard needs nothing', () => {
    expect(keyboardOverlap({top: 0, height: 200}, kb)).toBe(0);
  });

  test('no keyboard, or a zero-height one, needs nothing', () => {
    expect(keyboardOverlap({top: 0, height: 640}, null)).toBe(0);
    expect(keyboardOverlap({top: 0, height: 640}, {top: 640, height: 0})).toBe(
      0,
    );
  });

  test('never more than the keyboard itself', () => {
    expect(keyboardOverlap({top: 0, height: 2000}, kb)).toBe(280);
  });
});

describe('scrollDeltaToReveal', () => {
  const visible = {top: 100, bottom: 400};

  test('a field already in view does not scroll', () => {
    expect(scrollDeltaToReveal({top: 200, bottom: 252}, visible)).toBe(0);
  });

  test('a field under the keyboard scrolls down by what is hidden plus margin', () => {
    expect(scrollDeltaToReveal({top: 380, bottom: 432}, visible)).toBe(48);
  });

  test('a field above the top scrolls up', () => {
    expect(scrollDeltaToReveal({top: 90, bottom: 142}, visible)).toBe(-26);
  });

  test('a field taller than the visible area shows its start', () => {
    expect(scrollDeltaToReveal({top: 300, bottom: 800}, visible)).toBe(184);
  });
});

type Frame = {top: number; height: number};

describe.each(['android', 'ios'] as const)(
  'KeyboardAvoider on %s',
  platform => {
    let os: {restore: () => void};
    let events: Map<string, (e?: unknown) => void>;
    let spy: jest.SpyInstance;
    let frame: Frame;
    let app: Renderer.ReactTestRenderer;

    const show =
      platform === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hide = platform === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const emitShow = (height: number, screenY: number) =>
      act(async () => {
        events.get(show)!({endCoordinates: {height, screenY}, duration: 0});
      });
    const avoiderNode = () =>
      app.root.findAllByType(View).find(v => v.props.collapsable === false)!;
    const padding = () =>
      StyleSheet.flatten(avoiderNode().props.style).paddingBottom;

    beforeEach(async () => {
      os = jest.replaceProperty(Platform, 'OS', platform);
      events = new Map();
      spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((
        name: string,
        cb: (e?: unknown) => void,
      ) => {
        events.set(name, cb);
        return {remove: jest.fn()};
      }) as never);
      frame = {top: 0, height: 640};
      await act(async () => {
        app = Renderer.create(
          <KeyboardAvoider>
            <Text>form</Text>
          </KeyboardAvoider>,
        );
      });
      // RN's Jest View is a class whose measure() is an inert jest.fn; the ref the
      // component holds is that instance, so give it a real answer.
      // measure(x, y, width, height, pageX, pageY)
      avoiderNode().instance.measure = (cb: (...n: number[]) => void) =>
        cb(0, 0, 360, frame.height, 0, frame.top);
    });

    afterEach(async () => {
      await act(async () => app.unmount());
      spy.mockRestore();
      os.restore();
    });

    test('lifts the content by the covered part when the window is not resized', async () => {
      expect(padding()).toBe(0);
      await emitShow(280, 360);
      expect(padding()).toBe(280);
    });

    test('adds nothing when the window was already resized above the keyboard', async () => {
      frame = {top: 0, height: 360};
      await emitShow(280, 360);
      expect(padding()).toBe(0);
    });

    test('returns to normal when the keyboard closes', async () => {
      await emitShow(280, 360);
      expect(padding()).toBe(280);
      await act(async () => {
        events.get(hide)!({
          endCoordinates: {height: 0, screenY: 640},
          duration: 0,
        });
      });
      expect(padding()).toBe(0);
    });

    test('follows the keyboard to a new height', async () => {
      await emitShow(280, 360);
      await emitShow(220, 420);
      expect(padding()).toBe(220);
    });

    test('stops listening when it unmounts', async () => {
      const remove = jest.fn();
      spy.mockImplementation((() => ({remove})) as never);
      let other!: Renderer.ReactTestRenderer;
      await act(async () => {
        other = Renderer.create(<KeyboardAvoider />);
      });
      await act(async () => other.unmount());
      expect(remove).toHaveBeenCalledTimes(2);
    });
  },
);

describe('KeyboardAwareScrollView', () => {
  test('is still a ScrollView that keeps taps and drag-dismiss behaviour', async () => {
    let app!: Renderer.ReactTestRenderer;
    await act(async () => {
      app = Renderer.create(
        <KeyboardAwareScrollView>
          <Text>content</Text>
        </KeyboardAwareScrollView>,
      );
    });
    const scroll = app.root.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
    await act(async () => app.unmount());
  });
});
