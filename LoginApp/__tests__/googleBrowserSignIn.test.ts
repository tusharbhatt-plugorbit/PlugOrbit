import {Linking} from 'react-native';
import {signInWithGoogleBrowser} from '../src/services/googleBrowserSignIn';
const fetchMock=jest.fn();
beforeEach(()=>{jest.clearAllMocks();globalThis.fetch=fetchMock;});
test('browser URL cannot obtain the private app poll secret',async()=>{
  const flow_id='browser-flow-test-123456';const secret='app-only-poll-secret';
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({flow_id,poll_secret:secret})})
    .mockResolvedValueOnce({ok:true,json:async()=>({status:'complete',session:{id_token:'firebase-id',refresh_token:'refresh',expires_in:3600,user:{uid:'verified-user'}}})});
  expect((await signInWithGoogleBrowser())?.uid).toBe('verified-user');
  const url=(Linking.openURL as jest.Mock).mock.calls[0][0];
  expect(url).toContain(flow_id);expect(url).not.toContain(secret);
  expect(fetchMock.mock.calls[1][1].headers['X-Poll-Secret']).toBe(secret);
});
test('cancelled browser login makes no request',async()=>{
  const controller=new AbortController();controller.abort();
  expect(await signInWithGoogleBrowser(controller.signal)).toBeNull();expect(fetchMock).not.toHaveBeenCalled();
});
test('invalid server session is never accepted',async()=>{
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({flow_id:'browser-flow-test-123456',poll_secret:'secret'})})
    .mockResolvedValueOnce({ok:true,json:async()=>({status:'complete',session:{user:{uid:'u'}}})});
  await expect(signInWithGoogleBrowser()).rejects.toMatchObject({code:'SESSION_UNAVAILABLE'});
});
