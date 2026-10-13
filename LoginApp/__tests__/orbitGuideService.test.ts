/**
 * @format
 */

jest.mock('../src/services/backend', () => ({
  ...jest.requireActual('../src/services/backend'),
  request: jest.fn(),
}));
jest.mock('../src/services/session', () => ({
  ...jest.requireActual('../src/services/session'),
  getIdToken: jest.fn(),
}));

import {request} from '../src/services/backend';
import {askOrbit, orbitConfigured} from '../src/services/orbitAssistant';
import {getIdToken} from '../src/services/session';

const req = request as jest.Mock;
const token = getIdToken as jest.Mock;

beforeEach(() => {
  req.mockReset();
  token.mockReset();
});

test('the guide status and chat use the /assistant/guide endpoints, not Orbit Assist\'s', async () => {
  req.mockResolvedValueOnce({ok: true, body: {configured: true}});
  expect(await orbitConfigured()).toBe(true);
  expect(req).toHaveBeenCalledWith('GET', '/assistant/guide/status');

  token.mockResolvedValue('id-token');
  req.mockResolvedValueOnce({ok: true, body: {answer: 'Hello'}});
  expect(await askOrbit('Hi', [{sender: 'you', text: 'earlier'}])).toBe('Hello');
  const [method, path, options] = req.mock.calls[1];
  expect(method).toBe('POST');
  expect(path).toBe('/assistant/guide/chat');
  expect(options.token).toBe('id-token');
  expect(options.body.message).toBe('Hi');
  expect(options.body.history).toEqual([{role: 'user', text: 'earlier'}]);
});

test('not configured, or a failed status call, means offline', async () => {
  req.mockResolvedValueOnce({ok: true, body: {configured: false}});
  expect(await orbitConfigured()).toBe(false);
  req.mockResolvedValueOnce(null);
  expect(await orbitConfigured()).toBe(false);
});

test('asking while signed out explains that sign-in is needed', async () => {
  token.mockResolvedValue(null);
  await expect(askOrbit('Hi', [])).rejects.toThrow('Sign in to use online Orbit.');
  expect(req).not.toHaveBeenCalled();
});

test('a provider error shows the Backend\'s own message', async () => {
  token.mockResolvedValue('id-token');
  req.mockResolvedValueOnce({
    ok: false,
    body: {detail: {code: 'AI_RATE_LIMIT', message: 'Please wait a minute before asking again.'}},
  });
  await expect(askOrbit('Hi', [])).rejects.toThrow('Please wait a minute before asking again.');
});

test('no connection says so', async () => {
  token.mockResolvedValue('id-token');
  req.mockResolvedValueOnce(null);
  await expect(askOrbit('Hi', [])).rejects.toThrow('Could not connect to Orbit');
});
