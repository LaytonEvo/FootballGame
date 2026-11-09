import { createHmac } from 'node:crypto';
import { badRequest } from '../errors.js';

/** Normalise to E.164. Bare UK numbers (07…) become +44. */
export function normalisePhone(raw: string): string {
  const s = raw.replace(/[\s()-]/g, '');
  let e164: string;
  if (s.startsWith('+')) e164 = s;
  else if (s.startsWith('00')) e164 = `+${s.slice(2)}`;
  else if (s.startsWith('0')) e164 = `+44${s.slice(1)}`;
  else e164 = `+${s}`;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw badRequest('bad_phone', 'Enter a valid mobile number');
  return e164;
}

/** Keyed hash: the raw number is never stored (UK GDPR data minimisation). */
export function hashPhone(
  e164: string,
  secret = process.env.PHONE_HASH_SECRET ?? 'dev-only-phone-secret',
): string {
  return createHmac('sha256', secret).update(e164).digest('hex');
}
