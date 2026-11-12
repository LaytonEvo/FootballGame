import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useRules } from '../lib/rules';
import type { PickScreen, SelectionInput } from '../lib/types';
import { SHORT_LABEL, shirtLabel } from '../lib/types';
import { shortDateTime } from '../lib/format';
import { color, font, type } from '../lib/theme';
import type { SlotMeta } from '../features/picks/state';
import { setCaptain, summary, toggleAction, toggleBold } from '../features/picks/state';
import { Pitch, PITCH_ROWS, PitchRow } from '../components/Pitch';
import { PlayerSpot } from '../components/PlayerSpot';
import { ActionSheet } from '../components/ActionSheet';
import { Button, ErrorText, Loading, Screen, Small } from '../components/ui';
import { Shirt } from '../components/Shirt';

export default function Picks() {
  const { guided } = useLocalSearchParams<{ guided?: string }>();
  const screen = useApi<PickScreen>('/picks');
  const rules = useRules();
  const [input, setInput] = useState<SelectionInput | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (screen.data && !input) {
      setInput(screen.data.selection);
      if (guided && screen.data.selection.actions.every((a) => a.length === 0)) setOpen(4);
    }
  }, [screen.data, input, guided]);

  const metas: SlotMeta[] = useMemo(
    () =>
      (screen.data?.slots ?? []).map((s) => ({
        slot: s.slot,
        playerId: s.playerId,
        position: s.position,
        rarity: s.rarity,
      })),
    [screen.data],
  );
  if (!screen.data || !rules || !input) return <Loading />;
  const s = screen.data;
  const sum = summary(rules, metas, input);
  const locked = s.locked;

  const chipsFor = (slot: number) => {
    const meta = s.slots.find((x) => x.slot === slot)!;
    const acts = input.actions[slot] ?? [];
    return [0, 1].map((i) => {
      const id = acts[i];
      if (!id) return { label: '+ Add', state: 'empty' as const };
      const a = meta.actions.find((x) => x.id === id);
      const bold = input.bold?.slot === slot && input.bold.actionId === id;
      return {
        label: `${SHORT_LABEL[id] ?? a?.label ?? id}${bold ? ' · bold' : ''}`,
        value: `+${a?.points ?? 0}`,
        state: bold ? ('bold' as const) : ('set' as const),
      };
    });
  };

  const suggest = async (kind: 'last_week' | 'auto') => {
    try {
      const r = await api<{ selection: SelectionInput }>('/picks/suggest', { body: { kind, draft: input } });
      setInput(r.selection);
      void Haptics.selectionAsync().catch(() => {});
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/picks/${s.gameweek.id}/confirm`, { body: input });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const spot = (slot: number) => {
    const p = s.slots.find((x) => x.slot === slot)!;
    return (
      <PlayerSpot
        key={slot}
        name={p.name}
        position={p.position}
        shirt={shirtLabel(p)}
        rarity={p.rarity}
        fixture={p.fixtureLabel}
        captain={input.captain === slot}
        chips={chipsFor(slot)}
        onPress={locked ? undefined : () => setOpen(slot)}
        onLongPressChip={
          locked
            ? undefined
            : (i) => {
                const id = input.actions[slot]?.[i];
                if (id) setInput(toggleBold(input, slot, id));
              }
        }
        accessibilityHint="Opens scoring actions. Long-press an action to make it your bold action."
      />
    );
  };
  const sub = s.slots.find((x) => x.slot === 5);
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 22, color: color.ink }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.heading, fontSize: type.h2, color: color.ink }}>
            GW{s.gameweek.number} actions
          </Text>
          <Small>
            {locked
              ? 'Locked'
              : `Tap a player to pick scoring actions · locks ${shortDateTime(new Date(s.gameweek.deadlineAt))}`}
          </Small>
        </View>
      </View>
      {guided ? (
        <Small style={{ color: color.active }}>
          Pick one action for your striker, then tap Auto-pick for the rest. Set a captain, then Confirm.
        </Small>
      ) : null}
      {!locked ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            title="Same as last week"
            variant="secondary"
            style={{ flex: 1 }}
            disabled={!s.hasLastWeek}
            onPress={() => suggest('last_week')}
          />
          <Button title="Auto-pick" variant="secondary" style={{ flex: 1 }} onPress={() => suggest('auto')} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Small>
          Your five · {sum.setCount} of {sum.total} set
        </Small>
        <Small>
          GW{s.gameweek.number} · v{s.gameweek.scoringVersion} scoring
        </Small>
      </View>
      <Pitch>
        {PITCH_ROWS.map((row, i) => (
          <PitchRow key={i}>{row.map(spot)}</PitchRow>
        ))}
      </Pitch>
      {sub ? (
        <Pressable
          onPress={locked ? undefined : () => setOpen(5)}
          accessibilityRole="button"
          accessibilityLabel={`Substitute ${sub.name}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: color.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: color.border,
            padding: 8,
            minHeight: 48,
          }}
        >
          <Text style={{ fontFamily: font.bodyBold, fontSize: type.caption, color: color.muted }}>SUB</Text>
          <Shirt label={shirtLabel(sub)} rarity={sub.rarity} size={32} />
          <Text style={{ flex: 1, fontFamily: font.bodySemi, color: color.ink }}>
            {sub.name} <Text style={{ color: color.muted }}>{sub.fixtureLabel}</Text>
          </Text>
          <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>
            {(input.actions[5] ?? []).map((id) => SHORT_LABEL[id] ?? id).join(' · ') || '+ Add'}
          </Text>
        </Pressable>
      ) : (
        <Small>No sub yet. Your weekly free pack can fill the bench.</Small>
      )}
      <ErrorText>
        {err ?? (sum.errors[0]?.message && sum.setCount === sum.total ? sum.errors[0].message : null)}
      </ErrorText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Small>If every action lands</Small>
          <Text style={{ fontFamily: font.heading, fontSize: type.h2, color: color.active }}>
            {sum.potential} pts
          </Text>
        </View>
        {!locked ? (
          <Button
            title={s.confirmedAt ? 'Update' : 'Confirm'}
            style={{ flex: 1 }}
            disabled={!sum.canConfirm}
            loading={busy}
            onPress={confirm}
          />
        ) : null}
      </View>
      {s.confirmedAt && !locked ? (
        <Small>Confirmed. You can change your actions until the deadline.</Small>
      ) : null}
      <ActionSheet
        rules={rules}
        slot={open === null ? null : (s.slots.find((x) => x.slot === open) ?? null)}
        input={input}
        message={msg}
        onToggle={(id) => {
          const r = toggleAction(rules, metas, input, open!, id);
          setInput(r.input);
          setMsg(r.message ?? null);
        }}
        onCaptain={() => setInput(setCaptain(input, open!))}
        onBold={(id) => setInput(toggleBold(input, open!, id))}
        onProfile={() => {
          const pid = s.slots.find((x) => x.slot === open)?.playerId;
          setOpen(null);
          if (pid) router.push({ pathname: '/player/[id]', params: { id: pid } });
        }}
        onClose={() => {
          setOpen(null);
          setMsg(null);
        }}
      />
    </Screen>
  );
}
