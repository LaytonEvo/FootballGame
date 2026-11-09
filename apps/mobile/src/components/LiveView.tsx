import { Text, View } from 'react-native';
import type { HomeData } from '../lib/home';
import { SHORT_LABEL } from '../lib/types';
import { color, font, type } from '../lib/theme';
import { Card, Small } from './ui';
import { Pitch, PITCH_ROWS, PitchRow } from './Pitch';
import { PlayerSpot } from './PlayerSpot';

/** Matchday: pitch with points bubbles and pending / landed / missed chips, landed banner, league movement. */
export function LiveView({ home }: { home: HomeData }) {
  const live = home.live;
  if (!live) {
    return (
      <Card>
        <Text style={{ fontFamily: font.heading, fontSize: type.h3, color: color.ink }}>Actions locked</Text>
        <Small>Live scoring starts at the first kick-off.</Small>
      </Card>
    );
  }
  const spot = (slot: number) => {
    const s = live.slots.find((x) => x.slot === slot);
    if (!s) return <View key={slot} style={{ width: 112 }} />;
    return (
      <PlayerSpot
        key={slot}
        name={s.name}
        position={s.position}
        shirt={s.shirtNumber ? String(s.shirtNumber) : s.position}
        rarity={s.rarity}
        fixture={s.matchLabel}
        captain={s.captain}
        bubble={s.role === 'out' ? '0' : String(s.points)}
        chips={s.lines.map((l) => ({
          label: SHORT_LABEL[l.actionId] ?? l.label,
          value:
            l.state === 'pending'
              ? `+${l.potential}`
              : l.state === 'void'
                ? ''
                : `${l.points >= 0 ? '+' : ''}${l.points}`,
          state: l.state,
        }))}
      />
    );
  };
  const sub = live.slots.find((x) => x.slot === 5);
  return (
    <View style={{ gap: 12 }}>
      {live.provisional ? (
        <View style={{ backgroundColor: '#EEF1FF', borderRadius: 10, padding: 10 }}>
          <Small muted={false}>Provisional until 09:00 the morning after the last match.</Small>
        </View>
      ) : null}
      {live.lastLanded ? (
        <View
          style={{
            backgroundColor: color.landed.bg,
            borderColor: color.landed.border,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
          }}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ fontFamily: font.bodyBold, color: color.landed.text }}>
            ✓ {live.lastLanded.name}: {live.lastLanded.label} landed · +{live.lastLanded.points}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontFamily: font.heading, fontSize: type.hero, color: color.active }}>
          {live.total}
        </Text>
        <Small>pts this gameweek</Small>
      </View>
      <Pitch>
        {PITCH_ROWS.map((row, i) => (
          <PitchRow key={i}>{row.map(spot)}</PitchRow>
        ))}
      </Pitch>
      {sub ? (
        <Small>
          Sub: {sub.name} ·{' '}
          {sub.role === 'sub_in'
            ? `came on · ${sub.points} pts`
            : sub.role === 'sub_bench'
              ? 'not needed'
              : 'waiting'}
        </Small>
      ) : null}
      {live.leagueMoves.map((m) => (
        <Card key={m.leagueId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: font.bodySemi, color: color.ink }}>{m.name}</Text>
          <Text
            style={{
              fontFamily: font.bodyBold,
              color:
                m.previousRank && m.rank < m.previousRank
                  ? color.landed.text
                  : m.previousRank && m.rank > m.previousRank
                    ? color.missed.text
                    : color.muted,
            }}
          >
            {m.previousRank && m.rank < m.previousRank
              ? '▲'
              : m.previousRank && m.rank > m.previousRank
                ? '▼'
                : '•'}{' '}
            {m.rank}
          </Text>
        </Card>
      ))}
    </View>
  );
}
