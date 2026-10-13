import React, {useCallback, useEffect, useState} from 'react';
import {Text} from 'react-native';
import {useAppearance} from '../../appearance';
import type {Ticket} from '../../domain/types';
import {supportRequest} from '../../services/support';
import {Card, Notice, PrimaryButton, Screen, SectionTitle, TextButton, TextField, ToggleRow} from '../../ui';
export default function SupportAgentScreen() {
  const {colors} = useAppearance();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [text, setText] = useState(''); const [resolve, setResolve] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try {const body = await supportRequest('GET','/support/agent/tickets'); const list = body.tickets as Ticket[]; setTickets(list); setSelected(current => current ? list.find(t => t.id === current.id) ?? current : null);}
    catch(e) {setError(e instanceof Error ? e.message : 'Could not load the support inbox.');}
  }, []);
  useEffect(() => {reload();}, [reload]);
  const reply = async () => {
    if (!selected || !text.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const body = await supportRequest('POST',`/support/agent/tickets/${encodeURIComponent(selected.id)}/reply`,{text:text.trim(),resolve});
      setSelected(body.ticket as Ticket);setText('');await reload();
    } catch(e) {setError(e instanceof Error ? e.message : 'Could not send your reply.');}
    finally {setBusy(false);}
  };
  return <Screen title="Support inbox" stack onRefresh={reload} refreshing={busy}>
    {!!error && <Notice tone="danger" title="Support inbox" body={error}/>}
    {selected ? <>
      <TextButton label="All tickets" icon="arrow-left" onPress={() => {setSelected(null);setText('');setResolve(false);}}/>
      <SectionTitle title={`#${selected.number}: ${selected.title}`}/>
      {selected.messages.map(m => <Card key={m.id}><Text style={{color:colors.muted,fontWeight:'700',marginBottom:8}}>{m.from==='user' ? 'Customer' : m.author?.startsWith('orbit') ? 'Orbit automated help' : 'Support agent'}</Text><Text style={{color:colors.ink,lineHeight:22}}>{m.text}</Text></Card>)}
      <TextField label="Agent reply" value={text} onChangeText={setText} multiline maxLength={2000} placeholder="Write your response to the customer"/>
      <ToggleRow title="Resolve this ticket" value={resolve} onValueChange={setResolve}/>
      <PrimaryButton label="Send agent reply" onPress={reply} loading={busy} disabled={!text.trim()}/>
    </> : <>
      <Notice tone="info" title="Human support queue" body="Review Orbit's initial help, verify the issue and reply to the customer here."/>
      {tickets.length===0 && !error && <Text style={{color:colors.muted}}>No tickets in the inbox.</Text>}
      {tickets.map(t => <Card key={t.id} onPress={() => setSelected(t)}><Text style={{color:colors.ink,fontSize:16,fontWeight:'700'}}>{t.title}</Text><Text style={{color:colors.muted,marginTop:6}}>#{t.number} - {t.status}</Text></Card>)}
    </>}
  </Screen>;
}
