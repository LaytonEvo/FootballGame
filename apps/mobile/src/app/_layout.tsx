import { useEffect } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { useFonts, Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../lib/auth';
import { Loading } from '../components/ui';
import { usePushRegistration } from '../lib/push';

function Gate() {
  const { ready, me } = useAuth();
  const segments = useSegments();
  usePushRegistration(!!me?.profileComplete);
  useEffect(() => {
    if (!ready) return;
    const first = segments[0] as string | undefined;
    // profile-setup navigates on by itself (to the starter pack) once saved.
    const inOnboarding = first === 'sign-in' || first === 'verify';
    if (!me && first !== 'sign-in' && first !== 'verify' && first !== 'join') router.replace('/sign-in');
    else if (me && !me.profileComplete && first !== 'profile-setup') router.replace('/profile-setup');
    else if (me?.profileComplete && inOnboarding) router.replace('/');
  }, [ready, me, segments]);
  if (!ready) return <Loading />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
  if (!loaded) return <Loading />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
