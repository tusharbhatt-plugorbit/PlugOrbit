jest.mock('../src/services/emergencyCharge', () => ({...jest.requireActual('../src/services/emergencyCharge'),emergencyChargeRoute:jest.fn()}));
import {emergencyChargeRoute} from '../src/services/emergencyCharge';
jest.mock('../src/config/google', () => ({...jest.requireActual('../src/config/google'), hasGoogleApiKey:true}));
jest.mock('../src/services/places', () => ({...jest.requireActual('../src/services/places'),fetchNearbyChargers:jest.fn(),fetchChargerById:jest.fn()}));
jest.mock('../src/services/roadRouting', () => ({roadRoute:jest.fn()}));
import {fetchNearbyChargers,fetchChargerById,PlacesError} from '../src/services/places';
import {roadRoute} from '../src/services/roadRouting';
import {loadRouteStations} from '../src/services/mock/stationService';
import {createRouteService} from '../src/services/mock/routeService';
import {VEHICLE_CATALOG} from '../src/services/mock/data';
import {resetDemo} from '../src/store/demoStore';
const points=[{latitude:28.61,longitude:77.21},{latitude:29.2,longitude:77.7},{latitude:30.32,longitude:78.03}];
const charger={id:'highway',name:'Highway charger',address:'Highway',latitude:29.2,longitude:77.7,powerKw:60,available:null,total:2,hours:null,pricePerKwh:null,availabilityUpdatedAt:null,connectors:[{type:'CCS2',powerKw:60,count:2,available:null,outOfService:null}]};
beforeEach(()=>{jest.clearAllMocks();resetDemo();(fetchNearbyChargers as jest.Mock).mockResolvedValue([charger]);(roadRoute as jest.Mock).mockResolvedValue({points,distanceKm:220,durationMin:240});});
it('searches across the road and deduplicates results',async()=>{const stations=await loadRouteStations(points);const calls=(fetchNearbyChargers as jest.Mock).mock.calls;expect(calls.length).toBeGreaterThan(3);expect(calls[0][0]).toEqual(points[0]);expect(calls.at(-1)[0]).toEqual(points[2]);expect(calls.every(c=>c[2]===25000)).toBe(true);expect(stations.map(s=>s.id)).toEqual(['g-highway']);});
it('preserves API failures instead of reporting no chargers',async()=>{(fetchNearbyChargers as jest.Mock).mockRejectedValue(new PlacesError('API key rejected',403));await expect(loadRouteStations(points)).rejects.toThrow('API key rejected');});
it('plans outside the demo corridor using Google stations',async()=>{const route=await createRouteService(true).plan({fromLabel:'Current location',toLabel:'Dehradun, Uttarakhand',fromCoords:points[0],toCoords:points[2],startSoc:60,strategy:'fastest',vehicle:{...VEHICLE_CATALOG[0],id:'car',rangeKm100:250},safetyReservePct:10,avoidPaidParking:false});expect(route.geometrySource).toBe('road');expect(route.stops[0].station.id).toBe('g-highway');});

it('manual low-battery trip keeps the emergency first stop even if onward coverage has a gap',async()=>{
 const near={...charger,id:'near',latitude:points[0].latitude+.001,longitude:points[0].longitude};
 const station={id:'g-near',name:'Nearby charger',operator:'Google Maps',address:'Near departure',latitude:near.latitude,longitude:near.longitude,
 rating:0,successfulSessionsPct:0,reliabilityPct:0,sponsored:false,hours:'24/7',amenities:[],integration:'external',
 connectors:[{id:'connector',label:'CCS2',type:'CCS2',powerKw:60,pricePerKwh:null,status:'unknown'}],statusFeed:{source:'none',updatedAt:null},priceFeed:{source:'none',updatedAt:null}};
 (emergencyChargeRoute as jest.Mock).mockResolvedValue({station,road:{points:[points[0],near,points[2]],distanceKm:600,durationMin:600}});
 (fetchNearbyChargers as jest.Mock).mockResolvedValue([near]);
 const result=await createRouteService(true).plan({fromLabel:'Start',toLabel:'End',fromCoords:points[0],toCoords:points[2],startSoc:10,strategy:'fastest',vehicle:{...VEHICLE_CATALOG[0],id:'car',rangeKm100:250},safetyReservePct:12,avoidPaidParking:false});
 expect(emergencyChargeRoute).toHaveBeenCalled();expect(result.stops[0].station.id).toBe('g-near');
 expect(result.emergencyStationId).toBe('g-near');expect(result.chargingComplete).toBe(false);
 expect(result.corridorStations?.map(s=>s.id)).toContain('g-near');
});

it('shows actual route stations without an invented charging plan when connectors are unpublished',async()=>{
 (fetchNearbyChargers as jest.Mock).mockResolvedValue([{...charger,connectors:[]}]);
 const route=await createRouteService(true).plan({fromLabel:'Start',toLabel:'End',fromCoords:points[0],toCoords:points[2],startSoc:25,strategy:'fastest',vehicle:{...VEHICLE_CATALOG[0],id:'car',rangeKm100:250},safetyReservePct:12,avoidPaidParking:false});
 expect(route.chargingComplete).toBe(false);expect(route.stops).toEqual([]);
 expect(route.corridorStations?.map(s=>s.id)).toEqual(['g-highway']);
});
it('does not list Google-reported closed stations on the manual route',async()=>{
 (fetchNearbyChargers as jest.Mock).mockResolvedValue([{...charger,hours:'Closed'}]);
 const route=await createRouteService(true).plan({fromLabel:'Start',toLabel:'End',fromCoords:points[0],toCoords:points[2],startSoc:25,strategy:'fastest',vehicle:{...VEHICLE_CATALOG[0],id:'car',rangeKm100:250},safetyReservePct:12,avoidPaidParking:false});
 expect(route.stops).toEqual([]);expect(route.corridorStations).toEqual([]);
});

it('replans a manual route through the driver-selected compatible charger',async()=>{
 const request={fromLabel:'Start',toLabel:'End',fromCoords:points[0],toCoords:points[2],startSoc:70,strategy:'fastest' as const,vehicle:{...VEHICLE_CATALOG[0],id:'car',rangeKm100:500},safetyReservePct:12,avoidPaidParking:false};
 const {appStore}=require('../src/store/appStore'); appStore.set({vehicles:[request.vehicle],activeVehicleId:'car'});
 const service=createRouteService(true);const route=await service.plan(request);
 (fetchChargerById as jest.Mock).mockResolvedValue(charger);
 (roadRoute as jest.Mock).mockImplementation(async (coords:any[])=>({points:coords,distanceKm:20,durationMin:30}));
 const chosen=await service.chooseStation!(route,'g-highway');
 expect(chosen.stops[0].station.id).toBe('g-highway');expect(chosen.fromLabel).toBe('Start');expect(chosen.toLabel).toBe('End');
 (fetchChargerById as jest.Mock).mockResolvedValue({...charger,hours:'Closed'});
 await expect(service.chooseStation!(route,'g-highway')).rejects.toThrow('closed');
});
