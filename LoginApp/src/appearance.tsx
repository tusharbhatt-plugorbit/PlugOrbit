import React, {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {useColorScheme} from 'react-native';
import {getStorage} from './store/storage';
import {colors as base} from './theme';
export type AppearanceMode='system'|'light';
type Palette={[K in keyof typeof base]:string};
export const darkColors:Palette={...base,controlActive:'#075BD8',body:'#07182C',surface:'#142D49',ink:'#F2F7FF',inkSoft:'#C7D7EA',muted:'#9CB1CA',placeholder:'#A8BCD3',chipBorder:'#7692B0',divider:'#4B6785',inputBg:'#203B59',inputBorder:'#7692B0',limeDark:'#5AF1CE',limeSoft:'#123F3C',info:'#83BCFF',electric:'#67AEFF',infoSoft:'#173D67',amber:'#FFD08A',amberSoft:'#49351C',danger:'#FFAAA5',dangerSoft:'#492833',slateSoft:'#253B54',mapBg:'#10263F'};
const Context=createContext({mode:'system' as AppearanceMode,dark:false,colors:base as Palette,setMode:(_mode:AppearanceMode)=>{}});
export function AppearanceProvider({children}:{children:React.ReactNode}){
 const system=useColorScheme();const [mode,set]=useState<AppearanceMode>('system');
 useEffect(()=>{let alive=true;getStorage().getItem('plugorbit.appearance').then(v=>{if(alive&&(v==='light'||v==='system'))set(v);else if(alive&&v==='midnight'){set('system');getStorage().setItem('plugorbit.appearance','system').catch(()=>{});}}).catch(()=>{});return()=>{alive=false;};},[]);
 const dark=mode==='system'&&system==='dark';
 const value=useMemo(()=>({mode,dark,colors:dark?darkColors:base as Palette,setMode:(next:AppearanceMode)=>{set(next);getStorage().setItem('plugorbit.appearance',next).catch(()=>{});}}),[mode,dark]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useAppearance=()=>useContext(Context);
export function recolor<T>(value:T,palette:Palette):T{
 // Shared light hex values can mean text, a border or a divider. Resolve the
 // style property's semantic role before mapping so dark labels stay readable.
 const replacements=new Map<string,string>();
 for(const k of Object.keys(base) as (keyof Palette)[]){
   if(!replacements.has(base[k]) || palette[k]!==base[k]) replacements.set(base[k],palette[k]);
 }
 const textTokens:(keyof Palette)[]=['onAccent','onControlActive','chipText','ink','inkSoft','muted','placeholder','limeDark','danger','amber','info','electric'];
 const borderTokens:(keyof Palette)[]=['chipBorder','inputBorder','divider'];
 const textColors=new Map<string,string>(textTokens.map(k=>[base[k],palette[k]]));
 const borderColors=new Map<string,string>(borderTokens.map(k=>[base[k],palette[k]]));
 const visit=(v:unknown,key?:string):unknown=>{
 if(typeof v==='string'){
   if(key==='backgroundColor'&&(v==='#FFFFFF'||v==='#fff'))return palette.surface;
   if(key==='backgroundColor'&&v==='#F1F5F9')return palette.inputBg;
   if(key==='color'&&(v==='#FFFFFF'||v==='#fff'||v==='#FFF'))return v;
   if(key==='color')return textColors.get(v)??replacements.get(v)??v;
   if(key?.endsWith('Color') && key.toLowerCase().includes('border'))return borderColors.get(v)??replacements.get(v)??v;
   return replacements.get(v)??v;
 }
 if(Array.isArray(v))return v.map(x=>visit(x));
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,k)]));
 return v;
 };return visit(value) as T;
}
export function useThemedStyles<T>(styles:T):T{
 const {colors}=useAppearance();return useMemo(()=>recolor(styles,colors),[styles,colors]);
}
