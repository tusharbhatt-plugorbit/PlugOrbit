import React, {useEffect, useState} from 'react';
import {Keyboard, Platform, View} from 'react-native';

/**
 * Empty block as tall as the on-screen keyboard (iOS only). Put it at the end of
 * a form or bottom sheet so the last field can scroll above the keyboard; on
 * Android the window already resizes, so it stays 0.
 */
export function KeyboardSpacer() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    const show = Keyboard.addListener('keyboardWillShow', e =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return <View style={{height}} />;
}
