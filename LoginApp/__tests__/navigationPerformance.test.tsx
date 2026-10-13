import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text} from 'react-native';
import {AppNavigator,type Registry} from '../src/navigation/AppNavigator';
import {useNavigationState,useIsFocused,type Navigation} from '../src/navigation/NavigationContext';
it('keeps inactive tabs mounted without rerendering them for unrelated navigation',async()=>{
 const renders={home:0,trips:0};
 function Home(){renders.home++;useNavigationState();useIsFocused();return <Text>Home</Text>;}
 function Trips(){renders.trips++;useNavigationState();useIsFocused();return <Text>Trips</Text>;}
 function Detail(){useNavigationState();return <Text>Detail</Text>;}
 const registry={Home:{component:Home},Trips:{component:Trips},Profile:{component:Detail},RoutePlanner:{component:Detail}} as Registry;
 const ref:{current:Navigation|null}={current:null};let r!:Renderer.ReactTestRenderer;
 await act(async()=>{r=Renderer.create(<AppNavigator registry={registry} renderTabBar={()=>null} navigationRef={ref}/>);});
 await act(async()=>{ref.current!.switchTab('Trips');});
 const hiddenHome=renders.home;
 await act(async()=>{ref.current!.navigate('RoutePlanner');});
 await act(async()=>{ref.current!.switchTab('Profile');});
 expect(renders.home).toBe(hiddenHome);
 await act(async()=>{ref.current!.switchTab('Home');});
 expect(renders.home).toBeGreaterThan(hiddenHome);
 await act(async()=>{r.unmount();});
});
