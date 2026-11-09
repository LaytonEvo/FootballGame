import { Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { DISCLAIMER } from '@ff/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { color, font } from '../../lib/theme';
import { Body, Button, Card, H1, H3, Screen, Small } from '../../components/ui';

export const NOTIFICATION_KINDS: { key: string; label: string; defaultOn: boolean }[] = [
  {
    key: 'deadline_reminder',
    label: 'Deadline reminders (24h and 2h, only if not confirmed)',
    defaultOn: true,
  },
  { key: 'actions_carried_over', label: 'Actions carried over', defaultOn: true },
  { key: 'action_landed', label: 'Action landed', defaultOn: true },
  { key: 'league_overtaken', label: 'Overtaken in a mini-league', defaultOn: false },
  { key: 'recap_ready', label: 'Recap ready', defaultOn: true },
  { key: 'card_changed', label: 'Card changed club or went inactive', defaultOn: true },
  { key: 'new_pack', label: 'New pack (max one a day)', defaultOn: true },
];

export default function Profile() {
  const { me, refresh, signOut } = useAuth();
  if (!me) return null;
  const prefs = me.notificationPrefs ?? {};
  const set = async (key: string, v: boolean) => {
    await api('/me/notifications', { method: 'PUT', body: { [key]: v } });
    await refresh();
  };
  return (
    <Screen>
      <H1>{me.displayName}</H1>
      <Card>
        <H3>Your invite code</H3>
        <Text style={{ fontFamily: font.heading, fontSize: 22, color: color.active, letterSpacing: 2 }}>
          {me.inviteCode}
        </Text>
      </Card>
      <Card>
        <H3>Notifications</H3>
        {NOTIFICATION_KINDS.map((k) => (
          <View key={k.key} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
            <Body style={{ flex: 1 }}>{k.label}</Body>
            <Switch
              accessibilityLabel={k.label}
              value={prefs[k.key] ?? k.defaultOn}
              onValueChange={(v) => set(k.key, v)}
            />
          </View>
        ))}
        <Small>No marketing notifications during the test.</Small>
      </Card>
      <Card>
        <H3>About this test</H3>
        <Small>{DISCLAIMER}</Small>
        <Small>
          No real money, no purchases, no prizes. Coins and Season Points are worth nothing outside the game.
        </Small>
        <Small>
          Privacy: we keep a one-way hash of your phone number, your display name, favourite club and game
          activity. Scores use publicly reported match statistics under legitimate interests (UK GDPR). Ask us
          to delete your account at any time.
        </Small>
        <Button title="Privacy notice" variant="ghost" onPress={() => router.push('/privacy')} />
      </Card>
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
