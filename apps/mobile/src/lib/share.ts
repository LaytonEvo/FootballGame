import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { API_URL, api, getApiToken } from './api';

/** Download the server-rendered recap image and open the share sheet (WhatsApp is first in most UK share sheets). */
export async function shareRecap(gameweekId: string, format: 'story' | 'square') {
  const url = `${API_URL}/recap/${gameweekId}/share.png?format=${format}`;
  const headers: Record<string, string> = { authorization: `Bearer ${getApiToken() ?? ''}` };
  if (Platform.OS === 'web') {
    const blob = await (await fetch(url, { headers })).blob();
    globalThis.open?.(URL.createObjectURL(blob), '_blank');
  } else {
    const dir = new Directory(Paths.cache, 'share');
    if (!dir.exists) dir.create();
    const target = new File(dir, `gw-${gameweekId}-${format}.png`);
    if (target.exists) target.delete();
    const file = await File.downloadFileAsync(url, target, { headers });
    await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: 'Share my week' });
  }
  await api(`/recap/${gameweekId}/shared`, { body: { format, channel: Platform.OS } });
}
