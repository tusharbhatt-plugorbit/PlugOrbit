import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import Geolocation from '@react-native-community/geolocation';
import {ServicesProvider,createMockServices} from '../src/services';
import {useNearbyStations} from '../src/hooks/useNearbyStations';
import {seedSignedIn,NEXON} from '../src/dev/testHarness';
it('reuses recent stations after tab return and refreshes them after expiry',async()=>{
 seedSignedIn();(Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success=>success({coords:{latitude:28.61,longitude:77.21}}));
 const services=createMockServices();const nearby=jest.fn().mockResolvedValue([]);services.station={...services.station,nearby};
 function Harness({enabled}:{enabled:boolean}){useNearbyStations(NEXON,enabled);return null;}
 const view=(enabled:boolean)=><ServicesProvider services={services}><Harness enabled={enabled}/></ServicesProvider>;
 let r!:Renderer.ReactTestRenderer;
 await act(async()=>{r=Renderer.create(view(true));});expect(nearby).toHaveBeenCalledTimes(1);
 await act(async()=>{r.update(view(false));});await act(async()=>{r.update(view(true));});expect(nearby).toHaveBeenCalledTimes(1);
 const clock=jest.spyOn(Date,'now').mockReturnValue(Date.now()+61000);
 await act(async()=>{r.update(view(false));});await act(async()=>{r.update(view(true));});expect(nearby).toHaveBeenCalledTimes(2);
 await act(async()=>{r.unmount();});clock.mockRestore();
});
