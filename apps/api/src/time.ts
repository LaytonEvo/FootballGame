const LONDON = 'Europe/London';

/** UTC offset of Europe/London at an instant, in minutes (0 or 60). */
function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-]\d+)?(?::(\d+))?/.exec(tz);
  return m?.[1] ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 0;
}

export function londonDate(at: Date): { y: number; m: number; d: number } {
  const [d, m, y] = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(at)
    .split('/')
    .map(Number) as [number, number, number];
  return { y, m, d };
}

/** The UTC instant for a wall-clock time in Europe/London. */
export function londonToUtc(y: number, m: number, d: number, hour: number, minute = 0): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  const off = londonOffsetMinutes(new Date(guess.getTime() - londonOffsetMinutes(guess) * 60_000));
  return new Date(guess.getTime() - off * 60_000);
}

/** 09:00 Europe/London on the morning after the (London) date of `lastKickoff`. */
export function finalisationTime(lastKickoff: Date): Date {
  const { y, m, d } = londonDate(lastKickoff);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return londonToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 9);
}

/** Deadline: 90 minutes before the first kick-off. */
export const DEADLINE_BEFORE_KICKOFF_MS = 90 * 60_000;
export const deadlineFor = (firstKickoff: Date) =>
  new Date(firstKickoff.getTime() - DEADLINE_BEFORE_KICKOFF_MS);
