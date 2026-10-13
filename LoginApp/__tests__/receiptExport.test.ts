import {NativeModules, Platform} from 'react-native';
import {exportReceipt} from '../src/services/receiptExport';
const session = {id:'test-session',stationName:'Test charger',startedAt:Date.now(),energyKwh:10,durationMin:20,costInr:236,
  receiptNo:'TEST-1',status:'paid' as const,startSoc:20,endSoc:40,connectorLabel:'CCS2',powerKw:60,pricePerKwh:20};
const originalOS=Object.getOwnPropertyDescriptor(Platform,'OS');
beforeEach(()=>Object.defineProperty(Platform,'OS',{configurable:true,value:'android'}));
afterEach(()=>{delete NativeModules.PlugOrbitDeviceTools;if(originalOS)Object.defineProperty(Platform,'OS',originalOS);});
test('actual file save is required before reporting success',async()=>{
  const saveReceipt=jest.fn().mockResolvedValue('content://receipt');NativeModules.PlugOrbitDeviceTools={saveReceipt};
  expect(await exportReceipt(session)).toBe(true);
  const payload=JSON.parse(saveReceipt.mock.calls[0][0]);
  expect(payload.lines).toContain('GST calculation (18%): INR 36.00');
  expect(payload.lines.join(' ')).toContain('not an operator GST tax invoice');
});
test('cancelled file picker never reports a saved receipt',async()=>{
  NativeModules.PlugOrbitDeviceTools={saveReceipt:jest.fn().mockResolvedValue(null)};
  expect(await exportReceipt(session)).toBe(false);
});
test('missing native exporter gives a clear error',async()=>{
  await expect(exportReceipt(session)).rejects.toThrow('updated Android app');
});
