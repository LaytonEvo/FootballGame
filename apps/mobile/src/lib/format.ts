/** "1d 4h 12m" / "4h 12m" / "12m 03s" until a deadline, using the server's clock offset. */
export function countdown(deadline: Date, now: Date): string {
  const ms = Math.max(0, deadline.getTime() - now.getTime());
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/** "Sat 11:00" in the device's time zone (UK users: Europe/London). */
export function shortDateTime(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })
    .format(d)
    .replace(',', '');
}

/** Surname-ish short name for the name plate: "Bukayo Saka" → "Saka". */
export function plateName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : full;
}

/** Server-clock offset so countdowns never trust the device clock. */
export const clockOffset = (serverTime: string, receivedAt: number) =>
  new Date(serverTime).getTime() - receivedAt;

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
