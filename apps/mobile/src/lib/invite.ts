import { Platform, Share } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'ff.pendingInvite';
/** A league invite opened before sign-up is kept until onboarding finishes. */
export const pendingInvite = {
  async get() {
    return Platform.OS === 'web'
      ? (globalThis.localStorage?.getItem(KEY) ?? null)
      : SecureStore.getItemAsync(KEY);
  },
  async set(code: string | null) {
    if (Platform.OS === 'web')
      return code ? globalThis.localStorage?.setItem(KEY, code) : globalThis.localStorage?.removeItem(KEY);
    return code ? SecureStore.setItemAsync(KEY, code) : SecureStore.deleteItemAsync(KEY);
  },
};

export const shareInvite = (l: { name: string; url: string; code: string }) =>
  Share.share({ message: `Join my Fantasy Five mini-league "${l.name}": ${l.url} (code ${l.code})` });
