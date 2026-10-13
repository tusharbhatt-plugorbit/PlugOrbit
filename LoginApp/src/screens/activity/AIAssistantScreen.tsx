import {useAppearance, useThemedStyles} from '../../appearance';
import React, {useEffect, useRef, useState} from 'react';
import {askOrbit, orbitConfigured} from '../../services/orbitAssistant';
import {KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useNavigation} from '../../navigation/NavigationContext';
import {Screen} from '../../ui';
import {colors} from '../../theme';

type Message = {sender: 'you' | 'orbit'; text: string};
const quickQuestions = ['How can I find chargers?', 'How do I plan an EV trip?', 'What is SOC?', 'How do I book a slot?'];
function offlineReply(question: string): string {
  const q = question.toLowerCase();
  if (/login|sign.?in|google|sms|otp|mobile number|email/.test(q)) return 'Use email verification or Google from the sign-in screen. Google opens a browser: approve your account, then return to PlugOrbit. If mobile SMS reports a billing error, use email or Google while support completes SMS setup.';
  if (/receipt|invoice|gst|download/.test(q)) return 'Open Activity, choose your session and tap Download receipt. Select a folder in Files and tap Save. The app exports a session summary with a GST calculation; get the official GST tax invoice from the charging operator.';
  if (/qr|scan|camera/.test(q)) return 'Go to Charge and choose Scan charger QR. The camera scanner opens through Google Play services. Registered charger codes are checked for compatibility; an operator website QR requires you to choose Open QR website.';
  if (/cafe|coffee|amenit|food|restroom|parking|wifi/.test(q)) return 'Open a station, scroll to Nearby amenities and choose Cafes, Food or another category. Nearby Google Maps results show their addresses and an Open in Maps button. Verify opening hours and access.';
  if (/support|ticket|agent|help desk/.test(q)) return 'Open Support center, choose the issue category and describe what happened. Orbit gives automated initial help, and the ticket goes to the human support inbox. Agent replies appear in your ticket. Never share passwords or OTPs.';
  if (/theme|appearance|light mode|dark mode/.test(q)) return 'Open Profile and Appearance. Choose Light for the bright theme or System to follow your phone settings.';
  if (/sync|backup|saved data/.test(q)) return 'Sign in first, then open Profile and Account sync. Tap Sync now to back up supported app data to your Firebase account. Keep your connection active until it completes.';

  if (/route|trip|travel|distance|navigation/.test(q)) return 'Open Trips → Route Planner. Enter your destination and review charging stops. Check live charger availability before departing.';
  if (/charger|station|nearby|location|map/.test(q)) return 'Go to Home → Find chargers to explore nearby stations on the map. Turn on location permissions and check station details for connector compatibility.';
  if (/soc|battery|range|percent/.test(q)) return 'SOC means State of Charge: the battery percentage remaining. For longer trips, plan an arrival buffer and verify your car’s real-world range.';
  if (/book|reserv|slot|payment|wallet/.test(q)) return 'Open a station and check whether a Reservation option is offered. Confirm the operator, price and payment availability before booking.';
  return 'I can guide you through charging stations, trip planning, battery SOC and reservations. Choose a suggested question or ask about these features. Live generative AI is not connected yet.';
}
export default function AIAssistantScreen(): React.JSX.Element {
  const {colors: palette} = useAppearance();
  const styles = useThemedStyles(baseStyles);

  const nav = useNavigation();
  const threadRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const [draft, setDraft] = useState('');
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {let alive = true; orbitConfigured().then(value => {if (alive) setOnline(value);}); return () => {alive = false;};}, []);
  const [messages, setMessages] = useState<Message[]>([{sender: 'orbit', text: 'Hi! I am Orbit. Ask me about PlugOrbit, charging, your trip or battery.'}]);
  const send = async (q: string) => {
    const question = q.trim();
    if (!question || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    const history = messages.slice(1);
    setMessages(prev => [...prev, {sender: 'you', text: question}]); setDraft('');
    try {
      const answer = online ? await askOrbit(question, history) : offlineReply(question);
      setMessages(prev => [...prev, {sender: 'orbit', text: answer}]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Orbit.'); setDraft(question);
    } finally {sending.current = false; setBusy(false);}
  };
  return <Screen title="Orbit assistant" scroll={false} contentStyle={styles.screenContent}>
    <KeyboardAvoidingView style={styles.flex} enabled={false}>
      <View style={styles.notice}><Text style={styles.noticeText}>{online ? "Orbit AI - EV and PlugOrbit help" : "Offline EV guide - online AI is not connected"}</Text></View>
      <ScrollView ref={threadRef} onContentSizeChange={() => threadRef.current?.scrollToEnd({animated: true})} showsVerticalScrollIndicator={false} style={styles.flex} contentContainerStyle={styles.thread} keyboardShouldPersistTaps="handled">
        {messages.map((m,i) => <View key={i} style={[styles.bubble,m.sender==='you' ? styles.mine : styles.orbit]}><Text style={[styles.message,m.sender==='you' && styles.mineText]}>{m.text}</Text></View>)}
        <View style={styles.suggestions}>{quickQuestions.map(q=><Pressable accessibilityRole="button" accessibilityLabel={q} key={q} onPress={()=>send(q)} style={styles.chip}><Text style={styles.chipText}>{q}</Text></Pressable>)}</View>
        <Pressable onPress={()=>nav.navigate('RoutePlanner')} style={styles.route}><Text style={styles.routeText}>Plan an EV trip →</Text></Pressable>
      </ScrollView>
      {busy && <Text style={styles.noticeText}>Orbit is thinking...</Text>}
      {!!error && <><Text accessibilityRole="alert" style={styles.noticeText}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Use offline help" onPress={() => {setOnline(false); setError('');}} style={styles.chip}><Text style={styles.chipText}>Use offline help</Text></Pressable></>}
      <View style={styles.compose}><TextInput accessibilityLabel="Message to Orbit" maxLength={2000} style={styles.input} placeholder="Ask Orbit about your EV..." placeholderTextColor={palette.placeholder} value={draft} onChangeText={setDraft} onSubmitEditing={()=>send(draft)} returnKeyType="send"/><Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!draft.trim() || busy} accessibilityState={{disabled: !draft.trim() || busy}} onPress={()=>send(draft)} style={[styles.send, !draft.trim() && styles.sendDisabled]}><Text style={styles.sendText}>➤</Text></Pressable></View>
    </KeyboardAvoidingView>
  </Screen>;
}
const baseStyles = StyleSheet.create({
  screenContent: {paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0},
  flex: {flex: 1},
  notice: {backgroundColor: colors.infoSoft, padding: 12, borderRadius: 14, margin: 16, marginBottom: 0},
  noticeText: {fontSize: 12, fontWeight: '700', color: colors.info},
  thread: {padding: 16, gap: 12, paddingBottom: 24},
  bubble: {padding: 16, borderRadius: 20, maxWidth: '88%', borderWidth: 1},
  mine: {backgroundColor: '#075BD8', borderColor: '#075BD8', alignSelf: 'flex-end', borderBottomRightRadius: 6},
  orbit: {backgroundColor: colors.surface, borderColor: colors.inputBorder, alignSelf: 'flex-start', borderBottomLeftRadius: 6},
  message: {color: colors.ink, fontSize: 14, lineHeight: 22},
  mineText: {color: '#FFFFFF'},
  suggestions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8},
  chip: {borderRadius: 16, padding: 12, minHeight: 44, justifyContent: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder},
  chipText: {fontSize: 12, color: colors.ink, fontWeight: '600'},
  route: {padding: 16, borderRadius: 16, backgroundColor: '#075BD8', minHeight: 50, justifyContent: 'center'},
  routeText: {color: '#FFFFFF', fontWeight: '800'},
  compose: {flexDirection: 'row', padding: 12, gap: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.inputBorder},
  input: {flex: 1, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 14, color: colors.ink, minHeight: 50},
  send: {borderRadius: 16, backgroundColor: '#075BD8', height: 50, width: 50, alignItems: 'center', justifyContent: 'center'},
  sendDisabled: {backgroundColor: colors.slateSoft},
  sendText: {color: '#FFFFFF', fontSize: 23},
});
