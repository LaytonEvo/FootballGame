import { defineConfig } from 'vitest/config';

// Replay tests drive whole gameweeks through an embedded Postgres; give them room on slow CI runners.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
