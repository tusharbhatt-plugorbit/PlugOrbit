import {demoStore} from '../../store/demoStore';
import {ApiError, OfflineError} from '../types';

let counter = 0;

export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`;
}

let fast = false;

/** Tests turn latency off so flows resolve immediately. */
export function setFastMocks(value: boolean) {
  fast = value;
}

/** Simulated network latency. */
export function latency(ms = 350): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, fast ? 0 : ms));
}

/**
 * Every mock call goes through here, so the presenter's offline / API-error
 * switches behave the same for all services.
 */
export async function guard(ms = 350): Promise<void> {
  await latency(ms);
  const demo = demoStore.get();
  if (demo.offline) {
    throw new OfflineError();
  }
  if (demo.apiError) {
    throw new ApiError();
  }
}

/* eslint-disable no-bitwise */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/* eslint-enable no-bitwise */
