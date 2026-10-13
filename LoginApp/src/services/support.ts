import type {Ticket} from '../domain/types';
import type {SupportService} from './types';
import {isRecord, request} from './backend';
import {getIdToken} from './session';
import {appStore} from '../store/appStore';
export async function supportRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
  const token = await getIdToken(); if (!token) throw new Error('Sign in to contact support.');
  const response = await request(method, path, {token, body});
  if (!response) throw new Error('Could not reach support. Check your connection and retry.');
  if (!response.ok || !isRecord(response.body)) {
    const detail = isRecord(response.body) && isRecord(response.body.detail) ? response.body.detail : null;
    throw new Error(typeof detail?.message === 'string' ? detail.message : 'Support is temporarily unavailable.');
  }
  return response.body;
}
function remember(ticket: Ticket): Ticket {
  appStore.set(s => ({tickets: [ticket, ...s.tickets.filter(t => t.id !== ticket.id)].sort((a,b) => b.updatedAt-a.updatedAt)}));
  return ticket;
}
export async function supportAgentAccess(): Promise<boolean> {return (await supportRequest('GET', '/support/access')).agent === true;}
export function createBackendSupportService(): SupportService {
  let pending: {fingerprint: string; id: string} | null = null;
  return {
    async createTicket(input) {
      const fingerprint = JSON.stringify(input);
      if (!pending || pending.fingerprint !== fingerprint) pending = {fingerprint, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`};
      const requestId = pending.id;
      const body = await supportRequest('POST', '/support/tickets', {...input, requestId});
      pending = null;
      return remember(body.ticket as Ticket);
    },
    async reply(id, text) {const body = await supportRequest('POST', `/support/tickets/${encodeURIComponent(id)}/reply`, {text}); return remember(body.ticket as Ticket);},
    async list() {const body = await supportRequest('GET','/support/tickets'); const list = body.tickets as Ticket[]; list.forEach(remember); return list;},
    async get(id) {const body = await supportRequest('GET',`/support/tickets/${encodeURIComponent(id)}`); return remember(body.ticket as Ticket);},
  };
}
