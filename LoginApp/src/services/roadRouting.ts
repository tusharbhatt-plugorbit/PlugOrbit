import type {Coords} from '../utils/geo';
import {ApiError} from './types';
export type RoadGeometry={points:Coords[];distanceKm:number;durationMin:number};
const cache=new Map<string,RoadGeometry>();
const pending=new Map<string,Promise<RoadGeometry>>();
export async function roadRoute(points:readonly Coords[]):Promise<RoadGeometry>{
 if(points.length<2||points.some(p=>!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180))throw new ApiError('Choose valid start and destination locations.');
 const key=points.map(p=>p.longitude.toFixed(5)+','+p.latitude.toFixed(5)).join(';');
 if(cache.has(key))return cache.get(key)!;
 if(pending.has(key))return pending.get(key)!;
 const work=(async()=>{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
 try{
 const response=await fetch('https://router.project-osrm.org/route/v1/driving/'+key+'?overview=full&geometries=geojson&steps=false',{signal:controller.signal});
 if(!response.ok)throw new Error('routing rejected');
 const json=await response.json();const route=json.routes?.[0];
 if(json.code!=='Ok'||!route||!Array.isArray(route.geometry?.coordinates)||route.geometry.coordinates.length<2||!Number.isFinite(route.distance)||route.distance<=0||!Number.isFinite(route.duration)||route.duration<=0)throw new Error('route unavailable');
 const coordinates=route.geometry.coordinates;
 if(coordinates.some((p:unknown)=>!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error('invalid geometry');
 const result:RoadGeometry={points:coordinates.map((p:number[])=>({longitude:p[0],latitude:p[1]})),distanceKm:route.distance/1000,durationMin:Math.ceil(route.duration/60)};
 if(cache.size>=20)cache.delete(cache.keys().next().value!);
 cache.set(key,result);return result;
 }catch{throw new ApiError('Road directions are unavailable. Check your internet connection and try again.');}
 finally{clearTimeout(timer);}
 })();pending.set(key,work);
 try{return await work;}finally{pending.delete(key);}
}
