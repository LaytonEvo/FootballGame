import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { api } from './api';

/** Ask for push permission once signed up, and register the Expo push token with the server. */
export function usePushRegistration(enabled: boolean) {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    void (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;
        const token = (await Notifications.getExpoPushTokenAsync()).data;
        await api('/me/push-token', { body: { token } });
      } catch {
        /* push is optional */
      }
    })();
  }, [enabled]);
}

/** Tapping a push opens the screen it is about (data.route). */
export function useNotificationRouting(navigate: (route: string) => void) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const route = (r.notification.request.content.data as { route?: string } | undefined)?.route;
      if (route) navigate(route);
    });
    return () => sub.remove();
  }, [navigate]);
}
