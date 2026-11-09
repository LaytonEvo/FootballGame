import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { DISCLAIMER } from '@ff/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { color, font, radius, type } from '../lib/theme';
import { Body, Button, ErrorText, H1, Screen, Small } from '../components/ui';
import { Check } from '../components/Check';
import { inputStyle } from './sign-in';

export default function ProfileSetup() {
  const { refresh } = useAuth();
  const clubs = useApi<{ id: string; code: string; name: string }[]>('/clubs');
  const [name, setName] = useState('');
  const [club, setClub] = useState<string | null>(null);
  const [age, setAge] = useState(false);
  const [disc, setDisc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ starterPackId: string }>('/me/profile', {
        body: { displayName: name, favouriteClubId: club, ageConfirmed: age, disclaimerAccepted: disc },
      });
      await refresh();
      router.replace({ pathname: '/pack/[id]', params: { id: r.starterPackId, onboarding: '1' } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <H1>Set up your profile</H1>
      <View style={{ gap: 6 }}>
        <Body>Display name</Body>
        <TextInput
          style={inputStyle}
          value={name}
          onChangeText={setName}
          maxLength={20}
          placeholder="e.g. Sam"
          placeholderTextColor={color.muted}
          accessibilityLabel="Display name"
        />
      </View>
      <View style={{ gap: 6 }}>
        <Body>Favourite club (optional)</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(clubs.data ?? []).map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setClub(club === c.id ? null : c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: club === c.id }}
              accessibilityLabel={c.name}
              style={{
                minHeight: 44,
                minWidth: 56,
                paddingHorizontal: 10,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: radius.chip,
                borderWidth: 1,
                borderColor: club === c.id ? color.active : color.border,
                backgroundColor: club === c.id ? '#EEF1FF' : color.surface,
              }}
            >
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: color.ink }}>
                {c.code}
              </Text>
            </Pressable>
          ))}
        </View>
        <Small>Just for content. It never changes your squad or points.</Small>
      </View>
      <Check checked={age} onChange={setAge} label="I am 16 or over" />
      <Check checked={disc} onChange={setDisc} label={DISCLAIMER} />
      <Small>
        We store your number as a one-way hash, your display name and game activity, and use publicly reported
        match statistics to score the game (legitimate interests). See the privacy notice in Profile.
      </Small>
      <ErrorText>{err}</ErrorText>
      <Button
        title="Open my starter pack"
        onPress={save}
        loading={busy}
        disabled={name.trim().length < 2 || !age || !disc}
      />
    </Screen>
  );
}
