import type {ToolDeps} from '../assistant/tools';
import {createMockServices} from '../services';
import type {Services} from '../services/types';
import {appStore} from '../store/appStore';
import type {JourneyMemory, RememberedPreference} from '../assistant/types';

export function makeDeps(
  over: Partial<ToolDeps> & {services?: Services} = {},
): ToolDeps {
  return {
    services: over.services ?? createMockServices(),
    getState: () => appStore.get(),
    now: () => Date.now(),
    locate: async () => ({
      coords: {latitude: 28.6139, longitude: 77.209},
      outsideDemoArea: false,
    }),
    demo: true,
    journey: () => null as JourneyMemory | null,
    remembered: () => [] as RememberedPreference[],
    ...over,
  };
}
