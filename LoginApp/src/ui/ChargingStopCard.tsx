import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import Svg, {Circle} from 'react-native-svg';
import {useAppearance} from '../appearance';
import type {ScoredStop} from '../intelligence/types';
import {Card, KeyValue} from './Card';
import {Icon} from './Icon';
import {TextButton} from './Buttons';
import {formatDuration} from '../utils/format';
export function ChargingStopCard({stop,index,onPress}: {stop: ScoredStop; index: number; onPress: () => void}) {
  const {colors} = useAppearance();
  const p = Math.max(0,Math.min(100,stop.metrics.targetSoc));
  return <Card padded={false}>
    <View style={styles.hero}><Image source={require('../../assets/scenes/station-hub-v2.png')} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={styles.shade} />
      <View style={styles.top}><View style={styles.badge}><Icon name="plug-zap" color="#FFFFFF" size={16}/><Text style={styles.badgeText}>STOP {index+1}</Text></View><Text style={styles.photoNote}>Illustration</Text></View>
    </View>
    <View style={styles.content}><Text style={[styles.name,{color:colors.ink}]}>{stop.station.name}</Text><Text style={[styles.address,{color:colors.muted}]}>{stop.station.address || 'Address not published'}</Text>
      <View style={styles.metrics}><View style={styles.ring}><Svg width={80} height={80}><Circle cx={40} cy={40} r={33} fill="none" stroke={colors.divider} strokeWidth={7}/><Circle cx={40} cy={40} r={33} fill="none" stroke={colors.limeDark} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${207.35*p/100} 207.35`} rotation={-90} origin="40,40" /></Svg><Text style={[styles.percent,{color:colors.ink}]}>{Math.round(p)}%</Text></View>
      <View style={styles.flex}><KeyValue label="Arrive with" value={`${Math.round(stop.metrics.arriveSoc.expected)}%`} /><KeyValue label="Charge to" value={`${Math.round(p)}%`} last /></View></View>
      <View style={[styles.strip,{backgroundColor:colors.inputBg}]}><Icon name="route" size={16} color={colors.muted}/><Text style={{color:colors.ink}}>{Math.round(stop.alongKm)} km from start</Text><Text style={{color:colors.muted}}>{formatDuration(Math.round((stop.metrics.chargeMinutes.min+stop.metrics.chargeMinutes.max)/2))} charge</Text></View>
      <TextButton label="Charger details" icon="arrow-right" onPress={onPress}/>
    </View>
  </Card>;
}
const styles = StyleSheet.create({hero:{height:110,overflow:'hidden',borderTopLeftRadius:24,borderTopRightRadius:24},shade:{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(4,24,47,0.25)'},top:{flexDirection:'row',justifyContent:'space-between',padding:12},badge:{backgroundColor:'#075BD8',padding:8,borderRadius:12,flexDirection:'row',gap:6,alignItems:'center'},badgeText:{color:'#FFFFFF',fontWeight:'800',fontSize:11},photoNote:{color:'#FFFFFF',fontSize:10},content:{padding:16,gap:10},name:{fontSize:18,fontWeight:'800'},address:{fontSize:14,lineHeight:21},metrics:{flexDirection:'row',alignItems:'center',gap:14},flex:{flex:1},ring:{width:80,height:80,alignItems:'center',justifyContent:'center'},percent:{position:'absolute',fontWeight:'800',fontSize:17},strip:{flexDirection:'row',flexWrap:'wrap',gap:10,borderRadius:12,padding:12}});
