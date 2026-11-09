import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import type { Clock } from '../clock.js';
import { MINUTE } from '../clock.js';
import type { DbOrTx } from '../db/client.js';
import { otpChallenges } from '../db/schema.js';
import { badRequest } from '../errors.js';
import { newId, sha256 } from '../ids.js';

/** One-time-code delivery. Production: Twilio Verify. Dev/test: codes stored hashed locally and logged. */
export interface OtpService {
  start(phoneE164: string, phoneHash: string): Promise<void>;
  check(phoneE164: string, phoneHash: string, code: string): Promise<boolean>;
}

export const OTP_TTL_MS = 10 * MINUTE;
export const OTP_MAX_ATTEMPTS = 5;

export class LocalOtpService implements OtpService {
  /** Last code per phone hash — for tests and the dev console only. */
  readonly sent = new Map<string, string>();
  constructor(
    private db: DbOrTx,
    private clock: Clock,
    private log: (msg: string) => void = () => {},
  ) {}
  async start(phone: string, phoneHash: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.insert(otpChallenges).values({
      id: newId(),
      phoneHash,
      codeHash: sha256(`${phoneHash}:${code}`),
      expiresAt: new Date(this.clock.now().getTime() + OTP_TTL_MS),
    });
    this.sent.set(phoneHash, code);
    this.log(`[dev] one-time code for ${phone.slice(0, 4)}…${phone.slice(-2)}: ${code}`);
  }
  async check(_phone: string, phoneHash: string, code: string) {
    const now = this.clock.now();
    const [c] = await this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phoneHash, phoneHash),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!c) return false;
    if (c.attempts >= OTP_MAX_ATTEMPTS)
      throw badRequest('otp_locked', 'Too many attempts. Request a new code.');
    const ok = c.codeHash === sha256(`${phoneHash}:${code}`);
    await this.db
      .update(otpChallenges)
      .set(ok ? { consumedAt: now } : { attempts: c.attempts + 1 })
      .where(eq(otpChallenges.id, c.id));
    return ok;
  }
}

/** Twilio Verify (production). Credentials come from the environment; the phone number is never stored. */
export class TwilioVerifyOtpService implements OtpService {
  constructor(
    private sid = process.env.TWILIO_ACCOUNT_SID!,
    private token = process.env.TWILIO_AUTH_TOKEN!,
    private service = process.env.TWILIO_VERIFY_SERVICE_SID!,
  ) {}
  private async post(path: string, body: Record<string, string>) {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${this.service}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Twilio Verify ${path} failed: ${res.status}`);
    return res.ok ? ((await res.json()) as { status?: string }) : { status: 'not_found' };
  }
  async start(phone: string) {
    await this.post('Verifications', { To: phone, Channel: 'sms' });
  }
  async check(phone: string, _hash: string, code: string) {
    return (await this.post('VerificationCheck', { To: phone, Code: code })).status === 'approved';
  }
}

/**
 * Testing only: no SMS is sent and one fixed code signs in any number. The code is returned by /auth/start
 * so the app can fill it in. Enabled by OTP_BYPASS_CODE; anyone who knows a tester's number can sign in as
 * them, so never enable it once real players are on the build.
 */
export class BypassOtpService implements OtpService {
  readonly testCode: string;
  constructor(code: string) {
    if (!/^\d{4,8}$/.test(code)) throw new Error('OTP_BYPASS_CODE must be 4-8 digits');
    this.testCode = code;
  }
  async start() {}
  async check(_phone: string, _hash: string, code: string) {
    return code === this.testCode;
  }
}
