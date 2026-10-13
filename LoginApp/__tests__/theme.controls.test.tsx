jest.mock('react-native/Libraries/Utilities/useColorScheme',()=>({__esModule:true,default:()=> 'dark'}));
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Text,StyleSheet} from 'react-native';
import {AppearanceProvider,darkColors} from '../src/appearance';
import {colors} from '../src/theme';
import {Chip,SegmentedControl} from '../src/ui/Fields';
import {ListCard,ListRow} from '../src/ui/Card';
import {createMemoryStorage,setStorage} from '../src/store/storage';
for(const mode of ['light','system'] as const){
 it(`${mode} renders selected controls and ordinary text with the correct contrast roles`,async()=>{
  const storage=createMemoryStorage();setStorage(storage);await storage.setItem('plugorbit.appearance',mode);
  let tree!:Renderer.ReactTestRenderer;
  await act(async()=>{tree=Renderer.create(<AppearanceProvider><Chip label="Selected mint" selected onPress={()=>{}}/><SegmentedControl options={[{value:'a',label:'Active tab'},{value:'b',label:'Inactive tab'}]} value="a" onChange={()=>{}}/><ListCard><ListRow title="Readable box" icon="car"/></ListCard></AppearanceProvider>);});
  const text=(label:string)=>tree.root.findAllByType(Text).find(n=>n.props.children===label)!;
  const palette=mode==='light'?colors:darkColors;
  expect(StyleSheet.flatten(text('Selected mint').props.style).color).toBe(palette.onAccent);
  expect(StyleSheet.flatten(text('Active tab').props.style).color).toBe(palette.onControlActive);
  expect(StyleSheet.flatten(text('Inactive tab').props.style).color).toBe(palette.inkSoft);
  expect(StyleSheet.flatten(text('Readable box').props.style).color).toBe(palette.ink);
  await act(async()=>tree.unmount());setStorage(null);
 });
}
