import {useCallback, useEffect, useMemo} from 'react';
import {getAssistant} from '../../assistant/runtime';
import {useAssistantState} from '../../assistant/store';
import type {ChatMessage, FallbackLink} from '../../assistant/types';
import {tripStatus} from '../../intelligence/status';
import {useNavigation} from '../../navigation/NavigationContext';
import type {RouteName} from '../../navigation/params';
import {RUNS_ON_DEMO_DATA} from '../../services';
import {selectActiveVehicle, useApp} from '../../store/appStore';
import type {IconName} from '../../ui/Icon';
import {Linking} from 'react-native';

/**
 * Everything the assistant screens read and do, in one place, so the full
 * screen, the bottom sheet and driving mode behave identically.
 */

export type ContextItem = {icon: IconName; text: string};

export function useAssistantView() {
  const assistant = getAssistant();
  const nav = useNavigation();
  const messages = useAssistantState(s => s.messages);
  const phase = useAssistantState(s => s.phase);
  const partial = useAssistantState(s => s.partial);
  const level = useAssistantState(s => s.level);
  const settings = useAssistantState(s => s.settings);
  const microphone = useAssistantState(s => s.microphone);
  const gateway = useAssistantState(s => s.gateway);
  const recognizerAvailable = useAssistantState(s => s.recognizerAvailable);
  const synthAvailable = useAssistantState(s => s.synthAvailable);
  const speakingId = useAssistantState(s => s.speakingId);
  const journey = useAssistantState(s => s.journey);
  const vehicle = useApp(selectActiveVehicle);
  const battery = useApp(s => s.battery);
  const trip = useApp(s => s.smartDrive.trip);

  const consented = settings.aiConsentAt !== null;
  const ended = trip?.monitoringState === 'ended';
  const activeTrip = trip && !ended ? trip : null;

  const context = useMemo<ContextItem[]>(() => {
    const out: ContextItem[] = [];
    if (vehicle) {
      out.push({icon: 'car', text: `${vehicle.make} ${vehicle.model}`});
    }
    if (battery) {
      out.push({icon: 'battery', text: `${Math.round(battery.percent)}%`});
    }
    const to = activeTrip?.destination.label ?? journey?.destination;
    if (to) {
      out.push({icon: 'map-pin', text: `To ${to}`});
    }
    if (journey?.min_arrival_soc_pct !== undefined) {
      out.push({icon: 'gauge', text: `Keep ${journey.min_arrival_soc_pct}%`});
    }
    if (RUNS_ON_DEMO_DATA) {
      out.push({icon: 'info', text: 'Preview data'});
    }
    return out;
  }, [vehicle, battery, activeTrip, journey]);

  const tripLine = activeTrip ? tripStatus(activeTrip).headline : null;

  // Voice is usable when the phone has a recogniser and the driver has not turned it off.
  const canListen =
    consented && recognizerAvailable && microphone !== 'unavailable';
  const canSpeak = synthAvailable && !settings.textOnly;

  const send = useCallback(
    (text: string) => assistant.send(text, 'text'),
    [assistant],
  );
  const toggleMic = useCallback(() => assistant.toggleMic(), [assistant]);

  const openFallback = useCallback(
    (link: FallbackLink) => {
      (nav.navigate as (name: RouteName) => void)(link.route);
    },
    [nav],
  );

  const openPhoneSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);

  return {
    assistant,
    nav,
    messages: messages as ChatMessage[],
    phase,
    partial,
    level,
    settings,
    microphone,
    gateway,
    consented,
    canListen,
    canSpeak,
    synthAvailable,
    speakingId,
    context,
    activeTrip,
    tripLine,
    send,
    toggleMic,
    openFallback,
    openPhoneSettings,
  };
}

export type AssistantView = ReturnType<typeof useAssistantView>;

/** Refresh gateway and voice status whenever an assistant surface opens. */
export function useAssistantOpened(open: boolean): void {
  useEffect(() => {
    if (open) {
      const a = getAssistant();
      a.refreshGateway();
      a.refreshVoice();
    }
  }, [open]);
}

/** What the status line says. */
export function statusText(
  view: Pick<
    AssistantView,
    'phase' | 'partial' | 'consented' | 'gateway' | 'microphone' | 'settings'
  >,
): string {
  const {phase, partial, consented, gateway, settings} = view;
  if (!consented) {
    return 'Turn on Orbit’s AI to start.';
  }
  switch (phase) {
    case 'listening':
      return partial.trim() ? partial : 'Listening…';
    case 'thinking':
      return 'Checking…';
    case 'speaking':
      return 'Speaking. Tap the mic to interrupt.';
    case 'error':
      return 'Something went wrong. Try again.';
    default:
      break;
  }
  if (gateway.health === 'offline') {
    return 'Offline. The map and planner still work.';
  }
  if (gateway.health === 'signed_out') {
    return 'Sign in to your account to use Orbit’s AI.';
  }
  if (gateway.health === 'unavailable') {
    return 'The assistant isn’t available right now.';
  }
  return settings.textOnly
    ? 'Type your question.'
    : 'Tap the mic and ask Orbit.';
}

const TRIP_SETTING_KEYS = new Set(['min_arrival_soc_pct', 'strategy']);

/** Remembering a preference on this phone needs the driver's standing permission first. */
export function needsMemoryConsent(
  action: {kind: string; params: Record<string, unknown>},
  rememberPreferences: boolean,
): boolean {
  return (
    action.kind === 'save_preference' &&
    !rememberPreferences &&
    !TRIP_SETTING_KEYS.has(String(action.params.key))
  );
}
