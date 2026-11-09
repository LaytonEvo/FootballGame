import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Body, Button, ErrorText, H1, Screen } from '../components/ui';
import { inputStyle } from './sign-in';

export default function Verify() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { signIn } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const verify = async (c = code) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string }>('/auth/verify', { body: { phone, code: c } });
      await signIn(r.token);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <H1>Enter your code</H1>
      <Body muted>Sent to {phone}</Body>
      <View style={{ gap: 8 }}>
        <TextInput
          style={[inputStyle, { letterSpacing: 8, textAlign: 'center' }]}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            if (v.length === 6) void verify(v);
          }}
          accessibilityLabel="One-time code"
          autoFocus
        />
        <ErrorText>{err}</ErrorText>
        <Button title="Continue" onPress={() => verify()} loading={busy} disabled={code.length < 4} />
      </View>
    </Screen>
  );
}
