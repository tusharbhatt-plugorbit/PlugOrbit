import {Linking} from 'react-native';
import {directionsUrl, openDirections} from '../src/services/directions';
test('navigation uses device origin and exact selected destination', () => {
 const url = new URL(directionsUrl({id: 'dest', latitude: 28.54, longitude: 77.26}));
 expect(url.searchParams.get('destination')).toBe('28.54,77.26');
 expect(url.searchParams.get('dir_action')).toBe('navigate');
 expect(url.searchParams.has('origin')).toBe(false);
});
test('Google station navigation preserves its place identity', () => {
 expect(new URL(directionsUrl({id: 'g-ChIJtest', latitude: 28.54, longitude: 77.26})).searchParams.get('destination_place_id')).toBe('ChIJtest');
});
test('invalid destination is never opened', async () => {
 const open = jest.spyOn(Linking, 'openURL');
 expect(await openDirections({id: 'bad', latitude: NaN, longitude: 77})).toBe(false);
 expect(open).not.toHaveBeenCalled(); open.mockRestore();
});
