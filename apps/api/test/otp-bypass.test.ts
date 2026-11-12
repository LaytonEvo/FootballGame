import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { BypassOtpService } from '../src/services/otp.js';
import { testCtx } from './helpers.js';
import { MemoryPushSender } from '../src/services/push.js';
import { CommercialProvider } from '../src/providers/commercial.js';

let t: Awaited<ReturnType<typeof testCtx>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await testCtx();
  app = await buildApp({
    db: t.db,
    clock: t.clock,
    provider: new CommercialProvider(),
    push: new MemoryPushSender(),
    otp: new BypassOtpService('000000'),
  });
});
afterAll(() => t.close());

describe('SMS bypass for testing', () => {
  it('returns the test code and signs any number in with it, and nothing else', async () => {
    const start = await app.inject({ method: 'POST', url: '/auth/start', payload: { phone: '07700900555' } });
    expect(start.json()).toEqual({ sent: false, testCode: '000000' });
    const bad = await app.inject({
      method: 'POST',
      url: '/auth/verify',
      payload: { phone: '07700900555', code: '123456' },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/auth/verify',
      payload: { phone: '07700900555', code: '000000' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
  });
  it('rejects a malformed bypass code', () => {
    expect(() => new BypassOtpService('abc')).toThrow();
  });
});

describe('test builds skip the phone number', () => {
  it('guest sign-in works only with the bypass on, and leads to the normal profile step', async () => {
    expect((await app.inject({ method: 'GET', url: '/meta' })).json().phoneSignIn).toBe(false);
    const g = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(g.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${g.json().token}` };
    expect((await app.inject({ method: 'GET', url: '/me', headers })).json().profileComplete).toBe(false);
    const p = await app.inject({
      method: 'POST',
      url: '/me/profile',
      headers,
      payload: { displayName: 'Guest', ageConfirmed: true, disclaimerAccepted: true },
    });
    expect(p.json().starterPackId).toBeTruthy();
    // a second guest is a separate account
    const g2 = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(g2.json().user.id).not.toBe(g.json().user.id);
  });
});
