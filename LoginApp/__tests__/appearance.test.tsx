import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {Pressable,Text,StyleSheet} from 'react-native';
import {AppearanceProvider,useAppearance,useThemedStyles} from '../src/appearance';
import {colors} from '../src/theme';
import {BrandWordmark} from '../src/ui/BrandWordmark';
import {createMemoryStorage,setStorage} from '../src/store/storage';
let selectTheme=()=>{}; let shownMode=""; let textColor=""; let softColor=""; let borderColor=""; function Probe(){const appearance=useAppearance();const styles=useThemedStyles({text:{color:colors.ink},card:{backgroundColor:colors.surface},soft:{color:colors.inkSoft},border:{borderColor:colors.chipBorder}});selectTheme=()=>appearance.setMode("light"); shownMode=appearance.mode; textColor=styles.text.color;softColor=styles.soft.color;borderColor=styles.border.borderColor; return <Pressable onPress={()=>appearance.setMode('light')}><Text style={styles.text}>{appearance.mode}</Text></Pressable>;}
it('changes text and surfaces together and restores the saved appearance',async()=>{
 const storage=createMemoryStorage();setStorage(storage);
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AppearanceProvider><Probe/></AppearanceProvider>);});
 await act(async()=>{selectTheme();});
 expect(shownMode).toBe('light');
 expect(textColor).toBe(colors.ink);
 expect(softColor).toBe(colors.inkSoft);
 expect(borderColor).toBe(colors.chipBorder);
 expect(await storage.getItem('plugorbit.appearance')).toBe('light');
 await act(async()=>{tree.unmount();tree=Renderer.create(<AppearanceProvider><Probe/></AppearanceProvider>);});
 expect(shownMode).toBe('light');
 await act(async()=>tree.unmount());setStorage(null);
});


it('keeps the light auth wordmark dark even when the app appearance is midnight', async () => {
 const storage=createMemoryStorage();setStorage(storage);
 await storage.setItem('plugorbit.appearance','midnight');
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AppearanceProvider><BrandWordmark light={false}/></AppearanceProvider>);});
 const label=tree.root.findAllByType(Text).find(n=>Array.isArray(n.props.children)&&n.props.children[0]==='Plug')!;
 expect(StyleSheet.flatten(label.props.style).color).toBe('#0F172A');
 await act(async()=>{tree.update(<AppearanceProvider><BrandWordmark light/></AppearanceProvider>);});
 const darkLabel=tree.root.findAllByType(Text).find(n=>Array.isArray(n.props.children)&&n.props.children[0]==='Plug')!;
 expect(StyleSheet.flatten(darkLabel.props.style).color).toBe('#FFFFFF');
 await act(async()=>tree.unmount());setStorage(null);
});


it('migrates the removed midnight option to the system appearance', async () => {
 const storage=createMemoryStorage();setStorage(storage);
 await storage.setItem('plugorbit.appearance','midnight');
 let tree!:Renderer.ReactTestRenderer;
 await act(async()=>{tree=Renderer.create(<AppearanceProvider><Probe/></AppearanceProvider>);});
 expect(shownMode).toBe('system');
 expect(await storage.getItem('plugorbit.appearance')).toBe('system');
 await act(async()=>tree.unmount());setStorage(null);
});
