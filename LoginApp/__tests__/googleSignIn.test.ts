import {GoogleSignin} from '@react-native-google-signin/google-signin';
import {signInWithGoogle} from '../src/services/googleSignIn';

jest.mock('../src/config/googleAuth', () => ({googleSignInWebClientId: 'test.apps.googleusercontent.com'}));
const signin = GoogleSignin.signIn as jest.Mock;
const fetchMock = jest.fn();
beforeEach(() => {jest.clearAllMocks(); globalThis.fetch = fetchMock;});
test('cancelled account selection never contacts the backend', async () => {
  signin.mockResolvedValue({type: 'cancelled'});
  expect(await signInWithGoogle()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
test('exchanges the Google token for a validated Firebase session', async () => {
  signin.mockResolvedValue({type: 'success', data: {idToken: 'google-token'}});
  fetchMock.mockResolvedValue({ok: true, json: async () => ({id_token: 'firebase-token', refresh_token: 'refresh', expires_in: 3600, user: {uid: 'firebase-uid'}})});
  const session = await signInWithGoogle();
  expect(session?.uid).toBe('firebase-uid');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({id_token: 'google-token'});
});
test('malformed session cannot authenticate the app', async () => {
  signin.mockResolvedValue({type: 'success', data: {idToken: 'google-token'}});
  fetchMock.mockResolvedValue({ok: true, json: async () => ({user: {uid: 'u'}})});
  await expect(signInWithGoogle()).rejects.toMatchObject({code: 'SESSION_UNAVAILABLE'});
});
