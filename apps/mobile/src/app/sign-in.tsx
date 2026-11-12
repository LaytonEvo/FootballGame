import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { DISCLAIMER } from '@ff/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { color, font, radius, type } from '../lib/theme';
import { Body, Button, ErrorText, H1, Screen, Small } from '../components/ui';
import { Gradient } from '../components/Gradient';

export const inputStyle = {
  backgroundColor: color.surface,
  borderColor: color.border,
  borderWidth: 1,
  borderRadius: radius.button,
  paddingHorizontal: 14,
  minHeight: 52,
  fontFamily: font.bodyMedium,
  fontSize: type.h3,
  color: color.ink,
} as const;

export default function SignIn() {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const meta = useApi<{ phoneSignIn: boolean }>('/meta');
  const startGuest = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string }>('/auth/guest', { method: 'POST' });
      await signIn(r.token);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ sent: boolean; testCode?: string }>('/auth/start', { body: { phone } });
      if (r.testCode) {
        // Test build with SMS bypassed: sign straight in with the code the server handed back.
        const v = await api<{ token: string }>('/auth/verify', { body: { phone, code: r.testCode } });
        await signIn(v.token);
        return;
      }
      router.push({ pathname: '/verify', params: { phone } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Gradient radius={20} style={{ height: 140, justifyContent: 'flex-end', padding: 20 }}>
        <H1 style={{ color: '#fff' }}>Fantasy Five</H1>
        <Body style={{ color: '#fff' }}>Call what your five will do. Score when it happens.</Body>
      </Gradient>
      {meta.data && !meta.data.phoneSignIn ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          <Body>Test build: no phone number needed.</Body>
          <ErrorText>{err}</ErrorText>
          <Button title="Start playing" onPress={startGuest} loading={busy} />
          <Small>
            Your account lives on this device. Clearing the browser or switching device starts a new one.
          </Small>
        </View>
      ) : meta.data ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          <Body>Your mobile number</Body>
          <TextInput
            style={inputStyle}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder="07700 900123"
            placeholderTextColor={color.muted}
            value={phone}
            onChangeText={setPhone}
            accessibilityLabel="Mobile number"
          />
          <Small>We may text you a one-time code. No passwords.</Small>
          <ErrorText>{err}</ErrorText>
          <Button
            title="Continue"
            onPress={send}
            loading={busy}
            disabled={phone.replace(/\D/g, '').length < 9}
          />
        </View>
      ) : null}
      <Small style={{ marginTop: 24, textAlign: 'center' }}>{DISCLAIMER}</Small>
      <Small style={{ textAlign: 'center' }}>
        Closed test. No real money, no prizes. Coins have no value outside the game.
      </Small>
    </Screen>
  );
}
