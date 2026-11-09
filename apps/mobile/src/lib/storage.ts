import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'ff.session';

/** Session token: Keychain/Keystore on devices, localStorage on web (dev only). */
export const tokenStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
    return SecureStore.getItemAsync(KEY);
  },
  async set(v: string | null) {
    if (Platform.OS === 'web') {
      if (v) globalThis.localStorage?.setItem(KEY, v);
      else globalThis.localStorage?.removeItem(KEY);
      return;
    }
    if (v) await SecureStore.setItemAsync(KEY, v);
    else await SecureStore.deleteItemAsync(KEY);
  },
};
