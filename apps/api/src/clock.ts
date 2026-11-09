/** All time comes from here. The server never trusts the client clock. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  constructor(private t: Date) {}
  now() {
    return new Date(this.t);
  }
  set(t: Date | string) {
    this.t = new Date(t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
