/** Pack opening timeline from design/tokens.json: 0.6 s shake, 0.4 s tear + glow, 0.6 s flip, 0.3 s fade-in. */
export const PACK_MOTION = { shakeMs: 600, tearMs: 400, flipMs: 600, fadeMs: 300 } as const;

export type PackStage = 'sealed' | 'shake' | 'burst' | 'flip' | 'revealed';

/** When each stage starts after the tap (ms). Reduce Motion: straight to a fade. No near-miss effects, ever. */
export function packTimeline(reduceMotion: boolean): { stage: PackStage; at: number }[] {
  if (reduceMotion) return [{ stage: 'revealed', at: 0 }];
  const { shakeMs, tearMs, flipMs } = PACK_MOTION;
  return [
    { stage: 'shake', at: 0 },
    { stage: 'burst', at: shakeMs },
    { stage: 'flip', at: shakeMs + tearMs },
    { stage: 'revealed', at: shakeMs + tearMs + flipMs },
  ];
}
