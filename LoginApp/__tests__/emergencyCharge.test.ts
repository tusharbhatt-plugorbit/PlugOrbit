jest.mock('../src/services/mock/stationService', () => ({googleStations:jest.fn()}));
jest.mock('../src/services/roadRouting', () => ({roadRoute:jest.fn()}));
import {googleStations} from '../src/services/mock/stationService';
import {roadRoute} from '../src/services/roadRouting';
import {emergencyChargeRoute} from '../src/services/emergencyCharge';
import {mockStations, NEXON_EV, noon} from '../src/dev/smartDriveFixtures';
const origin={latitude:28.6,longitude:77.2};
const destination={latitude:29,longitude:78};
const station=(id:string,longitude:number) => ({...mockStations(noon())[0],id,latitude:28.6,longitude,hours:'24/7'});
beforeEach(()=>jest.clearAllMocks());
it('chooses by real road distance, including a charger in the opposite direction, then routes onward',async()=>{
 const near=station('near',77.199),other=station('other',77.21);
 (googleStations as jest.Mock).mockResolvedValue([near,other]);
 (roadRoute as jest.Mock).mockImplementation(async (points:any[])=>({points,distanceKm:points[1]===near?9:points[1]===other?2:150,durationMin:5}));
 const result=await emergencyChargeRoute(origin,destination,NEXON_EV,14,noon());
 expect(result.station.id).toBe('other');expect(result.road.distanceKm).toBe(152);
 expect(result.road.points).toEqual([origin,other,destination]);
});
it('does not invent connector compatibility',async()=>{
 (googleStations as jest.Mock).mockResolvedValue([{...station('unknown',77.201),connectors:[]}]);
 await expect(emergencyChargeRoute(origin,destination,NEXON_EV,14,noon())).rejects.toThrow('No reachable compatible charger');
 expect(roadRoute).not.toHaveBeenCalled();
});
it('refuses travel below the safe battery floor',async()=>{
 await expect(emergencyChargeRoute(origin,destination,NEXON_EV,4,noon())).rejects.toThrow('safe driving floor');
 expect(googleStations).not.toHaveBeenCalled();
});
