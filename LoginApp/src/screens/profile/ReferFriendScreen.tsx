import React from 'react';
import {Alert, Share, StyleSheet, Text, View} from 'react-native';
import {Screen, Card, PrimaryButton} from '../../ui';
const INVITE = 'I’m using PlugOrbit to explore EV charging stations and plan electric trips. Join me on PlugOrbit! (App download link coming soon.)';
export default function ReferFriendScreen(): React.JSX.Element {
  const invite = async () => { try {await Share.share({message:INVITE,title:'Invite to PlugOrbit'});} catch {Alert.alert('Unable to share','Try again from your phone.');} };
  return <Screen title="Refer a friend" stack>
    <View style={styles.hero}><Text style={styles.symbol}>✦</Text><Text style={styles.heading}>Good journeys are shared.</Text><Text style={styles.sub}>Invite friends to explore EV charging with PlugOrbit.</Text></View>
    <Card><Text style={styles.title}>Invite friends</Text><Text style={styles.body}>Share via WhatsApp, Messages, email or other installed apps using your phone’s native share sheet.</Text><Text style={styles.caption}>Referral rewards and unique referral codes are not active yet. No rewards are promised for sharing.</Text></Card>
    <PrimaryButton label="Share invitation" onPress={invite}/>
  </Screen>;
}
const styles=StyleSheet.create({hero:{backgroundColor:'#DFF5EB',padding:28,borderRadius:26,alignItems:'center',marginBottom:18},symbol:{fontSize:56,color:'#157A55'},heading:{fontSize:24,fontWeight:'800',color:'#153F35',textAlign:'center'},sub:{fontSize:14,color:'#456B60',textAlign:'center',marginTop:9},title:{fontSize:18,color:'#153F35',fontWeight:'800',marginBottom:8},body:{color:'#48665E',lineHeight:21},caption:{fontSize:12,color:'#667D76',marginTop:15}});
