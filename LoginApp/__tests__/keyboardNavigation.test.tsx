import React from 'react';
import {Keyboard, Platform, Text} from 'react-native';
import Renderer, {act} from 'react-test-renderer';
import {AppNavigator, Registry} from '../src/navigation/AppNavigator';

it.each(['android', 'ios'] as const)(
  'restores navigation after keyboard dismissal on %s',
  async platform => {
    const os = jest.replaceProperty(Platform, 'OS', platform);
    const events = new Map<string, () => void>();
    const removals: jest.Mock[] = [];
    const listener = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((name, callback) => {
        events.set(name, () => callback({} as never));
        const remove = jest.fn();
        removals.push(remove);
        return {remove};
      });
    const registry = {
      Home: {component: () => <Text>Form</Text>},
    } as unknown as Registry;
    let app!: Renderer.ReactTestRenderer;
    try {
      await act(async () => {
        app = Renderer.create(
          <AppNavigator
            registry={registry}
            renderTabBar={() => <Text>Navigation tabs</Text>}
          />,
        );
      });
      const tabs = () =>
        app.root
          .findAllByType(Text)
          .some(n => n.props.children === 'Navigation tabs');
      expect(tabs()).toBe(true);
      await act(async () =>
        events.get(
          Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
        )!(),
      );
      expect(tabs()).toBe(false);
      expect(
        app.root.findAllByType(Text).some(n => n.props.children === 'Form'),
      ).toBe(true);
      await act(async () =>
        events.get(
          Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
        )!(),
      );
      expect(tabs()).toBe(true);
      await act(async () => app.unmount());
      removals.forEach(remove => expect(remove).toHaveBeenCalledTimes(1));
    } finally {
      listener.mockRestore();
      os.restore();
    }
  },
);
