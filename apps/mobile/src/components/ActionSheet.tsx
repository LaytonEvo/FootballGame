import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import type { RuleSet } from '@ff/scoring';
import type { Tier } from '@ff/shared';
import { color, font, radius, type } from '../lib/theme';
import type { PickSlot, SelectionInput } from '../lib/types';
import { boldPenalty } from '../features/picks/state';
import { Shirt } from './Shirt';
import { Button, ErrorText } from './ui';
import { shirtLabel } from '../lib/types';

const ORDER: Tier[] = ['likely', 'possible', 'bold', 'long_shot', 'chaos'];
const NOTE: Partial<Record<Tier, string>> = {
  likely: 'happens most weeks',
  long_shot: 'rare, big payout',
  chaos: 'max 1 per squad',
};

/** Scoring actions sheet: grouped by tier with +N pts and a form hint; captain and bold toggles. */
export function ActionSheet({
  rules,
  slot,
  input,
  message,
  onToggle,
  onCaptain,
  onBold,
  onClose,
  onProfile,
}: {
  rules: RuleSet;
  slot: PickSlot | null;
  input: SelectionInput;
  message: string | null;
  onToggle: (actionId: string) => void;
  onCaptain: () => void;
  onBold: (actionId: string) => void;
  onClose: () => void;
  onProfile?: () => void;
}) {
  if (!slot) return null;
  const picked = input.actions[slot.slot] ?? [];
  const isSub = slot.slot === 5;
  const boldId = input.bold?.slot === slot.slot ? input.bold.actionId : null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(16,21,58,0.35)' }}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View
        style={{
          maxHeight: '86%',
          backgroundColor: color.surface,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: 16,
          gap: 10,
        }}
      >
        <View
          style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.track }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Shirt label={shirtLabel(slot)} rarity={slot.rarity} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.heading, fontSize: type.h3, color: color.ink }}>
              {slot.name} · scoring actions
            </Text>
            <Text style={{ fontFamily: font.body, fontSize: type.small, color: color.muted }}>
              {slot.position} · {slot.clubCode ?? '—'} · {slot.fixtureLabel}
            </Text>
            {onProfile ? (
              <Text
                onPress={onProfile}
                accessibilityRole="link"
                style={{
                  fontFamily: font.bodySemi,
                  fontSize: type.small,
                  color: color.active,
                  paddingVertical: 4,
                }}
              >
                Player profile ›
              </Text>
            ) : null}
          </View>
          <Text style={{ fontFamily: font.bodySemi, color: color.muted }}>
            {picked.length} of {rules.maxActions}
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ gap: 12 }}>
          {ORDER.map((tier, ti) => {
            const items = slot.actions.filter((a) => a.tier === tier);
            if (!items.length) return null;
            return (
              <View key={tier} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 2 }} accessibilityElementsHidden>
                    {[0, 1, 2, 3, 4].map((b) => (
                      <View
                        key={b}
                        style={{
                          width: 4,
                          height: 10,
                          borderRadius: 1,
                          backgroundColor: b <= ti ? color.active : color.track,
                        }}
                      />
                    ))}
                  </View>
                  <Text style={{ fontFamily: font.bodyBold, fontSize: type.small, color: color.ink }}>
                    {items[0]!.tierLabel}
                  </Text>
                  {NOTE[tier] ? (
                    <Text style={{ fontFamily: font.body, fontSize: type.caption, color: color.muted }}>
                      {NOTE[tier]}
                    </Text>
                  ) : null}
                </View>
                {items.map((a) => {
                  const sel = picked.includes(a.id);
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => onToggle(a.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: sel }}
                      accessibilityLabel={`${a.label}, ${a.points} points, ${a.tierLabel}${a.hint ? `, ${a.hint}` : ''}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        minHeight: 52,
                        paddingHorizontal: 12,
                        borderRadius: radius.tile,
                        borderWidth: 2,
                        borderColor: sel ? color.active : 'transparent',
                        backgroundColor: sel ? color.landed.bg : color.background,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: color.ink }}>
                          {a.label}
                        </Text>
                        {a.hint ? (
                          <Text style={{ fontFamily: font.body, fontSize: type.caption, color: color.muted }}>
                            {a.hint}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={{ fontFamily: font.heading, fontSize: type.small, color: color.active }}>
                        +{a.points} pts
                      </Text>
                      <Text style={{ width: 20, color: color.active, fontFamily: font.bodyBold }}>
                        {sel ? '✓' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
        <ErrorText>{message}</ErrorText>
        {!isSub ? (
          <Pressable
            onPress={onCaptain}
            accessibilityRole="switch"
            accessibilityState={{ checked: input.captain === slot.slot }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 44,
            }}
          >
            <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>Captain (×2 points)</Text>
            <Switch value={input.captain === slot.slot} onValueChange={onCaptain} />
          </Pressable>
        ) : null}
        {picked.map((id) => {
          const a = slot.actions.find((x) => x.id === id)!;
          const on = boldId === id;
          return (
            <Pressable
              key={id}
              onPress={() => onBold(id)}
              accessibilityRole="switch"
              accessibilityState={{ checked: on }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: 44,
                gap: 8,
              }}
            >
              <Text style={{ flex: 1, fontFamily: font.bodySemi, color: on ? color.boldAction : color.ink }}>
                Make {a.label} my bold action{' '}
                <Text style={{ fontFamily: font.body, color: color.muted }}>
                  (double if it lands, −{boldPenalty(rules, a.points)} if not)
                </Text>
              </Text>
              <Switch value={on} onValueChange={() => onBold(id)} />
            </Pressable>
          );
        })}
        <Button title="Done" onPress={onClose} />
      </View>
    </Modal>
  );
}
