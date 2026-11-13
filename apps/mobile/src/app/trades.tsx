import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { OwnedCard } from '../lib/types';
import { color, font } from '../lib/theme';
import { Button, Card, ErrorText, H1, H3, Loading, Screen, Small } from '../components/ui';
import { TradePair } from '../components/TradeCard';

interface TradeView {
  id: string;
  status: string;
  reason: string | null;
  direction: 'incoming' | 'outgoing';
  otherName: string;
  give: OwnedCard | null;
  get: OwnedCard | null;
  expiresAt: string;
}

const STATUS: Record<string, string> = {
  accepted: 'Traded',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default function Trades() {
  const t = useApi<{ incoming: TradeView[]; outgoing: TradeView[]; history: TradeView[] }>('/trades');
  const [err, setErr] = useState<string | null>(null);
  if (!t.data) return <Loading />;
  const act = async (id: string, action: 'accept' | 'decline' | 'cancel') => {
    setErr(null);
    try {
      await api(`/trades/${id}/${action}`, { method: 'POST' });
      await t.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const left = (iso: string) => {
    const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
    return h >= 24 ? `${Math.round(h / 24)}d left` : `${h}h left`;
  };
  const d = t.data;
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 22, color: color.ink }}>‹</Text>
        </Pressable>
        <H1>Trades</H1>
      </View>
      <Small>
        One card for one card, with people in your mini-leagues. No Coins or money ever change hands.
      </Small>
      <ErrorText>{err}</ErrorText>
      <H3>Offers for you</H3>
      {d.incoming.length === 0 ? <Small>No offers right now.</Small> : null}
      {d.incoming.map((x) => (
        <Card key={x.id}>
          <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>
            {x.otherName} offers · {left(x.expiresAt)}
          </Text>
          <TradePair give={x.give} get={x.get} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Accept" style={{ flex: 1 }} onPress={() => act(x.id, 'accept')} />
            <Button
              title="Decline"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => act(x.id, 'decline')}
            />
          </View>
        </Card>
      ))}
      <H3>Your offers</H3>
      {d.outgoing.length === 0 ? (
        <Small>Tap Trade under a card in your collection to make an offer.</Small>
      ) : null}
      {d.outgoing.map((x) => (
        <Card key={x.id}>
          <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>
            To {x.otherName} · waiting · {left(x.expiresAt)}
          </Text>
          <TradePair give={x.give} get={x.get} />
          <Button title="Cancel offer" variant="secondary" onPress={() => act(x.id, 'cancel')} />
        </Card>
      ))}
      {d.history.length ? <H3>History</H3> : null}
      {d.history.map((x) => (
        <View
          key={x.id}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            minHeight: 32,
            alignItems: 'center',
          }}
        >
          <Small muted={false}>
            {x.direction === 'outgoing' ? `To ${x.otherName}` : `From ${x.otherName}`}:{' '}
            {x.give?.player.name ?? '—'} ⇄ {x.get?.player.name ?? '—'}
          </Small>
          <Small>{STATUS[x.status] ?? x.status}</Small>
        </View>
      ))}
    </Screen>
  );
}
