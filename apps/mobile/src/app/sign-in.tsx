import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { DISCLAIMER } from '@ff/shared';
import { api } from '../lib/api';
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
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/start', { body: { phone } });
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
        <Small>We text you a one-time code. No passwords.</Small>
        <ErrorText>{err}</ErrorText>
        <Button
          title="Send code"
          onPress={send}
          loading={busy}
          disabled={phone.replace(/\D/g, '').length < 9}
        />
      </View>
      <Small style={{ marginTop: 24, textAlign: 'center' }}>{DISCLAIMER}</Small>
      <Small style={{ textAlign: 'center' }}>
        Closed test. No real money, no prizes. Coins have no value outside the game.
      </Small>
    </Screen>
  );
}
