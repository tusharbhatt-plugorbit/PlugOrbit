import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import Geolocation from '@react-native-community/geolocation';
import {ServicesProvider,createMockServices} from '../src/services';
import {resetNearbyCache, useNearbyStations} from '../src/hooks/useNearbyStations';
import {seedSignedIn,NEXON} from '../src/dev/testHarness';
it('reuses recent stations after tab return and refreshes them after expiry',async()=>{
 resetNearbyCache();seedSignedIn();(Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success=>success({coords:{latitude:28.61,longitude:77.21}}));
 const services=createMockServices();const nearby=jest.fn().mockResolvedValue([]);services.station={...services.station,nearby};
 function Harness({enabled}:{enabled:boolean}){useNearbyStations(NEXON,enabled);return null;}
 const view=(enabled:boolean)=><ServicesProvider services={services}><Harness enabled={enabled}/></ServicesProvider>;
 let r!:Renderer.ReactTestRenderer;
 await act(async()=>{r=Renderer.create(view(true));});expect(nearby).toHaveBeenCalledTimes(1);
 await act(async()=>{r.update(view(false));});await act(async()=>{r.update(view(true));});expect(nearby).toHaveBeenCalledTimes(1);
 // Past the 90 s lifetime of a loaded result.
 const clock=jest.spyOn(Date,'now').mockReturnValue(Date.now()+91000);
 await act(async()=>{r.update(view(false));});await act(async()=>{r.update(view(true));});expect(nearby).toHaveBeenCalledTimes(2);
 await act(async()=>{r.unmount();});clock.mockRestore();
});

it('does not search while disabled, then searches once when first enabled', async () => {
  resetNearbyCache();
  seedSignedIn();
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success =>
    success({coords: {latitude: 28.61, longitude: 77.21}}),
  );
  const services = createMockServices();
  const nearby = jest.fn().mockResolvedValue([]);
  services.station = {...services.station, nearby};
  function Harness({enabled}: {enabled: boolean}) {
    useNearbyStations(NEXON, enabled);
    return null;
  }
  const view = (enabled: boolean) => (
    <ServicesProvider services={services}>
      <Harness enabled={enabled} />
    </ServicesProvider>
  );
  let r!: Renderer.ReactTestRenderer;
  await act(async () => {
    r = Renderer.create(view(false));
  });
  expect(nearby).not.toHaveBeenCalled();
  await act(async () => {
    r.update(view(true));
  });
  expect(nearby).toHaveBeenCalledTimes(1);
  await act(async () => {
    r.unmount();
  });
});

it('seeds a second screen from the shared result without searching again', async () => {
  resetNearbyCache();
  seedSignedIn();
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success =>
    success({coords: {latitude: 28.61, longitude: 77.21}}),
  );
  const services = createMockServices();
  const nearby = jest.fn().mockResolvedValue([]);
  services.station = {...services.station, nearby};
  function Harness() {
    useNearbyStations(NEXON);
    return null;
  }
  const view = () => (
    <ServicesProvider services={services}>
      <Harness />
    </ServicesProvider>
  );
  let first!: Renderer.ReactTestRenderer;
  await act(async () => {
    first = Renderer.create(view());
  });
  expect(nearby).toHaveBeenCalledTimes(1);
  let second!: Renderer.ReactTestRenderer;
  await act(async () => {
    second = Renderer.create(view());
  });
  expect(nearby).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.unmount();
    second.unmount();
  });
});

it('locates the device when a screen is hidden before its first search finished', async () => {
  resetNearbyCache();
  seedSignedIn();
  const USER = {latitude: 28.61, longitude: 77.21};
  // The device fix is slow: it only arrives after the screen was hidden and shown again.
  // (The location service shares one in-flight request, so there is a single fix to answer.)
  const pending: Array<(p: unknown) => void> = [];
  (Geolocation.getCurrentPosition as jest.Mock).mockReset();
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success => {
    pending.push(success);
  });
  const services = createMockServices();
  const nearby = jest.fn().mockResolvedValue([]);
  services.station = {...services.station, nearby};
  function Harness({enabled}: {enabled: boolean}) {
    useNearbyStations(NEXON, enabled);
    return null;
  }
  const view = (enabled: boolean) => (
    <ServicesProvider services={services}>
      <Harness enabled={enabled} />
    </ServicesProvider>
  );
  let r!: Renderer.ReactTestRenderer;
  await act(async () => {
    r = Renderer.create(view(true));
  });
  expect(nearby).not.toHaveBeenCalled(); // still waiting for the first fix
  await act(async () => {
    r.update(view(false));
  });
  await act(async () => {
    r.update(view(true));
  });
  await act(async () => {
    pending.forEach(answer => answer({coords: USER}));
  });
  // The retry located the device and searched around it, not around the default centre.
  expect(nearby).toHaveBeenCalledTimes(1);
  expect(nearby.mock.calls[0][0].origin).toEqual(USER);
  await act(async () => {
    r.unmount();
  });
});
