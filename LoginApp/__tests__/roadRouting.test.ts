import {roadRoute} from '../src/services/roadRouting';
const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;});
it('decodes road vertices and uses provider road distance and time',async()=>{
 globalThis.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({code:'Ok',routes:[{distance:28500,duration:1980,geometry:{coordinates:[[77.209,28.6139],[77.18,28.59],[77.0266,28.4595]]}}]})});
 const line=await roadRoute([{latitude:28.6139,longitude:77.209},{latitude:28.4595,longitude:77.0266}]);
 expect(line.points).toHaveLength(3);expect(line.points[1]).toEqual({latitude:28.59,longitude:77.18});
 expect(line.distanceKm).toBe(28.5);expect(line.durationMin).toBe(33);
 expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('overview=full&geometries=geojson'),expect.any(Object));
});
it('rejects network errors instead of silently drawing a straight route',async()=>{
 globalThis.fetch=jest.fn().mockRejectedValue(new Error('offline'));
 await expect(roadRoute([{latitude:29,longitude:77},{latitude:30,longitude:78}])).rejects.toThrow('Road directions are unavailable');
});
it('rejects malformed geometry',async()=>{
 globalThis.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({code:'Ok',routes:[{distance:1000,duration:600,geometry:{coordinates:[[500,29],[78,30]]}}]})});
 await expect(roadRoute([{latitude:29,longitude:76},{latitude:30,longitude:77}])).rejects.toThrow('Road directions are unavailable');
});
