import { useEffect } from 'react';
import { AppState as RNAppState } from 'react-native';
import { resolveOrigin } from '../hooks/useDiscoverStations';
import { useNavigation } from '../navigation/NavigationContext';
import type { Navigation } from '../navigation/NavigationContext';
import { LocationError } from '../services/location';
import { RUNS_ON_DEMO_DATA, useServices } from '../services';
import type { Services } from '../services/types';
import { appStore } from '../store/appStore';
import { performAction } from './actions';
import { AssistantController } from './controller';
import { createGateway } from './gateway';
import { startProactive } from './proactive';
import {
  activePreferences,
  assistantStore,
  eraseAssistantData,
  flushAssistantStore,
  freshJourney,
  hydrateAssistantStore,
} from './store';
import { createToolRunner } from './tools';
import type { ToolDeps } from './tools';
import { DEFAULT_SETTINGS } from './types';
import type { ToolEnvelope } from './types';
import { createNativeVoice } from './voice/native';

/**
 * Wiring. One controller lives for the life of the app; it is created on first
 * use with the real gateway and speech libraries, and `AssistantBridge`
 * (mounted once, headless) gives it the app's services and navigation.
 */

const attached: { services: Services | null; nav: Navigation | null } = {
  services: null,
  nav: null,
};

export function attachAssistant(
  services: Services | null,
  nav: Navigation | null,
): void {
  attached.services = services;
  attached.nav = nav;
}

function toolDeps(): ToolDeps {
  if (!attached.services) {
    throw new Error('Orbit Assist is not attached to the app yet.');
  }
  return {
    services: attached.services,
    getState: () => appStore.get(),
    now: Date.now,
    demo: RUNS_ON_DEMO_DATA,
    journey: () => freshJourney(assistantStore.get()),
    remembered: () => activePreferences(assistantStore.get()),
    locate: async () => {
      const where = await resolveOrigin(false);
      if (!where.userLocation) {
        throw new LocationError(
          where.locationIssue === 'denied' ? 'denied' : 'unavailable',
          'Location is not available.',
        );
      }
      return { coords: where.userLocation, outsideDemoArea: where.demoArea };
    },
  };
}

let controller: AssistantController | null = null;

export function getAssistant(): AssistantController {
  if (!controller) {
    controller = new AssistantController({
      gateway: createGateway(),
      demo: RUNS_ON_DEMO_DATA,
      voice: createNativeVoice(),
      runTool: async (call): Promise<ToolEnvelope> => {
        try {
          return await createToolRunner(toolDeps())(call);
        } catch {
          return {
            status: 'unavailable',
            message: 'The app isn’t ready to check that yet.',
          };
        }
      },
      performAction: (action, options) =>
        performAction(
          action,
          { tools: toolDeps(), getNav: () => attached.nav },
          options,
        ),
    });
  }
  return controller;
}

/** Test helper: drop the singleton (and its attachments), or swap in one built with fakes. */
export function resetAssistantRuntime(
  replacement: AssistantController | null = null,
): void {
  controller = replacement;
  attachAssistant(null, null);
}

/**
 * Headless. Attaches services and navigation, loads the saved settings, starts
 * the proactive watcher, and stops all listening/talking when the app leaves
 * the foreground.
 */
export function AssistantBridge(): null {
  const services = useServices();
  const nav = useNavigation();

  useEffect(() => {
    attachAssistant(services, nav);
  }, [services, nav]);

  useEffect(() => {
    const assistant = getAssistant();
    let stop: (() => void) | null = null;
    let live = true;
    hydrateAssistantStore().then(() => {
      if (!live) {
        return;
      }
      assistant.refreshVoice();
      stop = startProactive(assistant, { demo: RUNS_ON_DEMO_DATA });
    });
    const sub = RNAppState.addEventListener('change', next => {
      if (next !== 'active') {
        assistant.onBackground();
        flushAssistantStore();
      } else {
        assistant.onForeground();
      }
    });
    return () => {
      live = false;
      stop?.();
      sub.remove();
      attachAssistant(null, null);
      if (!appStore.get().signedIn) {
        // Signed out (or the account was deleted): the next person to use this phone must
        // not inherit a conversation, a journey, remembered preferences or an AI consent.
        assistant.clearHistory();
        eraseAssistantData();
        assistantStore.set({ settings: DEFAULT_SETTINGS });
      }
    };
  }, []);

  return null;
}
