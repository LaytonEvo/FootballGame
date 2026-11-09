import { describe, expect, it } from 'vitest';
import tokens from '../../../design/tokens.json';
import { PACK_MOTION, packTimeline } from '../src/lib/motion';

describe('pack opening motion', () => {
  it('follows the token spec: 0.6 s shake, 0.4 s tear + glow, 0.6 s flip, 0.3 s fade', () => {
    expect(tokens.motion.pack_open).toContain(
      '0.6s shake, 0.4s tear + rarity glow, 0.6s card flip, 0.3s fade-in',
    );
    expect(PACK_MOTION).toEqual({ shakeMs: 600, tearMs: 400, flipMs: 600, fadeMs: 300 });
    expect(packTimeline(false)).toEqual([
      { stage: 'shake', at: 0 },
      { stage: 'burst', at: 600 },
      { stage: 'flip', at: 1000 },
      { stage: 'revealed', at: 1600 },
    ]);
  });
  it('Reduce Motion goes straight to a fade', () => {
    expect(packTimeline(true)).toEqual([{ stage: 'revealed', at: 0 }]);
  });
});
