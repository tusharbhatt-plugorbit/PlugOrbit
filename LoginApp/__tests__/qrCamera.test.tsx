import React from 'react';
import {AppState} from 'react-native';
import Renderer, {act} from 'react-test-renderer';
import {useCameraDevice, useCameraPermission} from 'react-native-vision-camera';
import LiveQrCamera from '../src/components/LiveQrCamera';

jest.mock('react-native-vision-camera', () => {
  const ReactMock = require('react');
  const {View} = require('react-native');
  return {
    Camera: Object.assign(
      (props: object) =>
        ReactMock.createElement(View, {testID: 'native-camera', ...props}),
      {
        getCameraPermissionStatus: jest.fn(() => 'not-determined'),
      },
    ),
    useCameraDevice: jest.fn(() => ({id: 'back'})),
    useCameraPermission: jest.fn(),
    useCodeScanner: (options: object) => options,
  };
});
const permission = useCameraPermission as jest.Mock;
const device = useCameraDevice as jest.Mock;
let app: Renderer.ReactTestRenderer;
let state: PropertyDescriptor | undefined;
beforeEach(() => {
  state = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  permission.mockReturnValue({
    hasPermission: true,
    requestPermission: jest.fn(),
  });
  device.mockReturnValue({id: 'back'});
});
afterEach(async () => {
  if (app) {
    await act(async () => app.unmount());
  }
  if (state) {
    Object.defineProperty(AppState, 'currentState', state);
  }
});
async function open(active = true, onDecoded = jest.fn()) {
  await act(async () => {
    app = Renderer.create(
      <LiveQrCamera active={active} onDecoded={onDecoded} />,
    );
  });
  return onDecoded;
}
it('requests permission before mounting a camera', async () => {
  const requestPermission = jest.fn().mockResolvedValue(true);
  permission.mockReturnValue({hasPermission: false, requestPermission});
  await open();
  expect(app.root.findAllByProps({testID: 'native-camera'})).toHaveLength(0);
  await act(async () =>
    app.root.findByProps({accessibilityLabel: 'Allow'}).props.onPress(),
  );
  expect(requestPermission).toHaveBeenCalledTimes(1);
});
it('delivers nonempty QR payloads and pauses while manual entry is open', async () => {
  const decoded = await open();
  let preview = app.root.findByProps({testID: 'native-camera'});
  expect(preview.props.isActive).toBe(true);
  await act(async () =>
    preview.props.codeScanner.onCodeScanned([
      {value: ''},
      {value: 'CHARGER-C2'},
    ]),
  );
  expect(decoded).toHaveBeenCalledWith('CHARGER-C2');
  decoded.mockClear();
  await act(async () =>
    app.update(<LiveQrCamera active={false} onDecoded={decoded} />),
  );
  preview = app.root.findByProps({testID: 'native-camera'});
  expect(preview.props.isActive).toBe(false);
  preview.props.codeScanner.onCodeScanned([{value: 'CHARGER-C2'}]);
  expect(decoded).not.toHaveBeenCalled();
});
it('shows recovery when the camera fails instead of a blank preview', async () => {
  await open();
  await act(async () =>
    app.root
      .findByProps({testID: 'native-camera'})
      .props.onError(new Error('busy')),
  );
  expect(app.root.findAllByProps({testID: 'native-camera'})).toHaveLength(0);
  await act(async () =>
    app.root.findByProps({accessibilityLabel: 'Retry camera'}).props.onPress(),
  );
  expect(
    app.root.findAllByProps({testID: 'native-camera'}).length,
  ).toBeGreaterThan(0);
});
it('keeps manual entry usable on devices without a rear camera', async () => {
  device.mockReturnValue(undefined);
  await open();
  expect(app.root.findAllByProps({testID: 'native-camera'})).toHaveLength(0);
});

it('offers settings after a camera permission denial', async () => {
  permission.mockReturnValue({hasPermission: false, requestPermission: jest.fn().mockResolvedValue(false)});
  await open();
  await act(async () => app.root.findByProps({accessibilityLabel: 'Allow'}).props.onPress());
  expect(app.root.findAllByProps({accessibilityLabel: 'Open settings'}).length).toBeGreaterThan(0);
  expect(app.root.findAllByProps({testID: 'native-camera'})).toHaveLength(0);
});
