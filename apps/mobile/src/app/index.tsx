import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Constants from 'expo-constants';
import { DISCLAIMER } from '@ff/shared';

const API = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000';

export default function Index() {
  const [status, setStatus] = useState('connecting…');
  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((j: { time: string }) => setStatus(`API ok · server time ${j.time}`))
      .catch(() => setStatus('API not reachable'));
  }, []);
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F4F6FA',
        padding: 24,
      }}
    >
      <Text style={{ fontSize: 24, fontWeight: '700', color: '#10153A' }}>Fantasy Five</Text>
      <Text style={{ marginTop: 8, color: '#5A6178' }}>{status}</Text>
      <Text style={{ marginTop: 24, fontSize: 11, color: '#5A6178', textAlign: 'center' }}>{DISCLAIMER}</Text>
    </View>
  );
}
