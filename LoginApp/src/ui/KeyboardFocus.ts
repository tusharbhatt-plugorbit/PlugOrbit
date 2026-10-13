import {createContext} from 'react';
import type React from 'react';
import type {TextInput} from 'react-native';
export type FocusInput = React.ElementRef<typeof TextInput>;
export const KeyboardFocus = createContext<(input: FocusInput | null) => void>(() => {});
