import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const newId = () => randomUUID();
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Human-friendly code without ambiguous characters (no 0/O, 1/I/L). */
export function shortCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
