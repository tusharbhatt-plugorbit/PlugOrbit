import React, {useEffect, useState} from 'react';
import {AppState, Linking, StyleSheet, View} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import {Notice, PermissionPrompt, SecondaryButton} from '../ui';
import type {QrCameraProps} from './QrCamera';

export default function LiveQrCamera({active, onDecoded}: QrCameraProps) {
  const {hasPermission, requestPermission} = useCameraPermission();
  const [permissionDenied, setPermissionDenied] = useState(
    Camera.getCameraPermissionStatus() !== 'not-determined',
  );
  const device = useCameraDevice('back');
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state =>
      setForeground(state === 'active'),
    );
    return () => sub.remove();
  }, []);
  const scanning = active && foreground && hasPermission && !error;
  const scanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      const value = codes.find(code => code.value?.trim())?.value;
      if (scanning && value) {
        onDecoded(value);
      }
    },
  });
  if (!hasPermission) {
    return (
      <View style={styles.message}>
        <PermissionPrompt
          kind="camera"
          denied={permissionDenied}
          onAllow={() => {
            requestPermission()
              .then(granted => setPermissionDenied(!granted))
              .catch(() => setError(true));
          }}
          onOpenSettings={() => {
            Linking.openSettings().catch(() => setError(true));
          }}
        />
        {error && (
          <Notice
            title="Camera permission unavailable"
            body="Try opening app settings, or enter the charger ID manually."
          />
        )}
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.message}>
        <Notice
          title="No rear camera found"
          body="Enter the charger ID manually to continue."
        />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.message}>
        <Notice
          title="Camera could not start"
          body="Close other apps using the camera and try again, or enter the charger ID manually."
        />
        <SecondaryButton
          label="Retry camera"
          onPress={() => {
            setError(false);
            setAttempt(n => n + 1);
          }}
        />
      </View>
    );
  }
  return (
    <Camera
      key={attempt}
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={scanning}
      codeScanner={scanner}
      onError={() => setError(true)}
    />
  );
}
const styles = StyleSheet.create({
  message: {width: '100%', padding: 12, gap: 8},
});
