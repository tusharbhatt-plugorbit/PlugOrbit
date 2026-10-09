/**
 * PlugOrbit Smart Drive: the intelligence layer.
 *
 * Five layers, kept apart on purpose (see docs/SMART_DRIVE.md):
 *   1. data            domain/ + the World a service supplies
 *   2. safety          safety.ts            deterministic rules, run first
 *   3. recommendation  recommendation.ts    explainable weighted score
 *   4. automation      monitor.ts, notifications.ts, chargingPlan.ts
 *   5. explanation     explain.ts           explains, never decides
 *
 * Nothing in here imports React, the store or a service.
 */
export * from './analytics';
export * from './backup';
export * from './battery';
export * from './chargingPlan';
export * from './config';
export * from './confidence';
export * from './copy';
export * from './explain';
export * from './hours';
export * from './monitor';
export * from './notifications';
export * from './offline';
export * from './preferences';
export * from './recommendation';
export * from './safety';
export * from './sessionBridge';
export * from './status';
export * from './stopMetrics';
export * from './types';
export * from './wait';
