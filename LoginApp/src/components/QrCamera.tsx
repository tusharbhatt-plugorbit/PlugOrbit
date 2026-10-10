import React from 'react';
import {NativeModules} from 'react-native';
import {Notice} from '../ui';

export type QrCameraProps = {
  active: boolean;
  onDecoded: (value: string) => void;
};

/** Older installed binaries can still open manual entry without a native crash. */
export function QrCamera(props: QrCameraProps) {
  if (!NativeModules.CameraView) {
    return (
      <Notice
        title="Camera update needed"
        body="Install the latest app to scan QR codes. You can enter the charger ID manually."
      />
    );
  }
  const LiveQrCamera = require('./LiveQrCamera')
    .default as React.ComponentType<QrCameraProps>;
  return <LiveQrCamera {...props} />;
}
