import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { pendingInvite, shareInvite } from '../../lib/invite';
import { ordinal } from '../../lib/format';
import { color, font, type } from '../../lib/theme';
import { Button, Card, ErrorText, H1, H3, Loading, Screen, Small } from '../../components/ui';
import { inputStyle } from '../sign-in';

interface MyLeague {
  id: string;
  name: string;
  code: string;
  url: string;
  size: number;
  rank: number | null;
  points: number;
}

export default function Leagues() {
  const leagues = useApi<MyLeague[]>('/leagues');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  // A league invite opened before sign-up lands here after onboarding.
  useEffect(() => {
    void pendingInvite.get().then(async (c) => {
      if (!c) return;
      try {
        const l = await api<{ id: string; name: string }>('/leagues/join', { body: { code: c } });
        await pendingInvite.set(null);
        setJoined(l.name);
        router.push({ pathname: '/league/[id]', params: { id: l.id } });
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }, []);

  if (!leagues.data) return <Loading />;
  const create = async () => {
    try {
      const l = await api<MyLeague>('/leagues', { body: { name } });
      setName('');
      await leagues.reload();
      await shareInvite(l);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const join = async () => {
    try {
      const l = await api<{ id: string; name: string }>('/leagues/join', { body: { code } });
      setCode('');
      setJoined(l.name);
      await leagues.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Screen>
      <H1>Leagues</H1>
      {joined ? <Small style={{ color: color.landed.text }}>You joined {joined}.</Small> : null}
      <Pressable
        onPress={() => router.push({ pathname: '/league/[id]', params: { id: 'global' } })}
        accessibilityRole="button"
      >
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <H3>Global</H3>
            <Small>Everyone in the test · season, month and week tables</Small>
          </View>
          <Text style={{ fontSize: 20, color: color.muted }}>›</Text>
        </Card>
      </Pressable>
      {leagues.data.map((l) => (
        <Pressable
          key={l.id}
          onPress={() => router.push({ pathname: '/league/[id]', params: { id: l.id } })}
          accessibilityRole="button"
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <H3>{l.name}</H3>
              <Small>
                {l.rank ? `${ordinal(l.rank)} of ${l.size}` : `${l.size} players`} · {l.points} pts
              </Small>
            </View>
            <Button title="Invite" variant="ghost" onPress={() => shareInvite(l)} />
          </Card>
        </Pressable>
      ))}
      <Card>
        <H3>Start a mini-league</H3>
        <TextInput
          style={inputStyle}
          placeholder="League name"
          placeholderTextColor={color.muted}
          value={name}
          onChangeText={setName}
          maxLength={30}
          accessibilityLabel="League name"
        />
        <Button title="Create and share link" onPress={create} disabled={name.trim().length < 2} />
      </Card>
      <Card>
        <H3>Join with a code</H3>
        <TextInput
          style={[inputStyle, { letterSpacing: 4 }]}
          autoCapitalize="characters"
          placeholder="ABC123"
          placeholderTextColor={color.muted}
          value={code}
          onChangeText={setCode}
          maxLength={12}
          accessibilityLabel="Invite code"
        />
        <Button title="Join" variant="secondary" onPress={join} disabled={code.trim().length < 4} />
      </Card>
      <ErrorText>{err}</ErrorText>
      <Text style={{ fontFamily: font.body, fontSize: type.caption, color: color.muted }}>
        Season Points decide every table. Coins never do.
      </Text>
    </Screen>
  );
}
