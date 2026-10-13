/**
 * The help guide's optional online answers (backend `/assistant/guide/*`, a single-shot
 * chat). This is not Orbit Assist, the tool-using co-driver, which lives in `src/assistant`.
 */
import {isRecord, request} from './backend';
import {getIdToken} from './session';
import {appStore, getActiveVehicle} from '../store/appStore';
export type OrbitTurn = {sender: 'you' | 'orbit'; text: string};
export async function orbitConfigured(): Promise<boolean> {
  const response = await request('GET', '/assistant/guide/status');
  return !!(response?.ok && isRecord(response.body) && response.body.configured);
}
export async function askOrbit(message: string, history: OrbitTurn[]): Promise<string> {
  const token = await getIdToken();
  if (!token) throw new Error('Sign in to use online Orbit.');
  const state = appStore.get();
  const trip = state.smartDrive.trip;
  const vehicle = getActiveVehicle();
  const context = JSON.stringify({vehicle: vehicle ? `${vehicle.make} ${vehicle.model}` : null, batteryPercent: state.battery?.percent,
    trip: trip ? {from: trip.origin.label, to: trip.destination.label, remainingKm: trip.distanceRemainingKm,
      complete: trip.plan.itinerary?.complete ?? false,
      stops: trip.plan.itinerary?.stops.map(s => ({name: s.station.name, chargeTo: s.metrics.targetSoc})) ?? []} : null});
  const response = await request('POST', '/assistant/guide/chat', {token, body: {message,
    history: history.slice(-8).map(m => ({role: m.sender === 'you' ? 'user' : 'model', text: m.text.slice(0, 2000)})), context}});
  if (!response) throw new Error('Could not connect to Orbit. Check your connection and retry.');
  if (!response.ok || !isRecord(response.body) || typeof response.body.answer !== 'string') {
    const detail = isRecord(response.body) && isRecord(response.body.detail) ? response.body.detail : null;
    throw new Error(typeof detail?.message === 'string' ? detail.message : 'Orbit is temporarily unavailable.');
  }
  return response.body.answer;
}
